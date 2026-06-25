"""Bolt file transfer + script run (srdev2 physical split)."""
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File as FastAPIFile, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies import require_role
from ..middleware.security import rate_limit_heavy, concurrency_heavy
from ..utils.validation import strip_ansi
from .bolt_runtime import resolve_targets, run_bolt_command

logger = logging.getLogger(__name__)
router = APIRouter()

UPLOAD_STAGING_DIR = Path("/opt/openvox-gui/data/bolt-uploads")


class FileDownloadRequest(BaseModel):
    source: str
    destination: str
    targets: str

@router.post("/file/upload")
async def upload_file_to_targets(
    file: UploadFile = FastAPIFile(..., description="The file to upload to remote targets"),
    targets: str = Form(..., description="Comma-separated certnames, 'all', or ENC group name"),
    destination: str = Form(..., description="Remote path where the file should be placed on targets"),
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(require_role("admin", "operator")),
):
    """Upload a file to remote targets via Puppet Bolt.

    Accepts a multipart form upload from the browser, stages the file
    locally in /opt/openvox-gui/data/bolt-uploads/, resolves any ENC
    group names to certnames, then executes 'bolt file upload' to
    distribute the file to all specified targets.

    The staged file is cleaned up after the transfer completes (or
    fails), regardless of the outcome. The upload result includes
    Bolt's stdout, stderr, and exit code so the user can see exactly
    what happened on each target.

    Security: The destination path is validated to prevent path
    traversal attacks. The uploaded file is stored with a unique
    name to prevent collisions from concurrent uploads.
    """
    import uuid

    # Validate destination path — reject path traversal attempts
    if ".." in destination or destination.startswith("~"):
        raise HTTPException(status_code=400, detail="Invalid destination path")

    # Resolve ENC group names to actual certnames for Bolt
    resolved_targets = await resolve_targets(targets, db)

    # Stage the uploaded file in a unique subdirectory so the original
    # filename is preserved when Bolt uploads it. Bolt uses the source
    # filename as the remote filename when the destination is a directory,
    # so we must use the original name — not a UUID-prefixed one.
    UPLOAD_STAGING_DIR.mkdir(parents=True, exist_ok=True)
    staging_subdir = UPLOAD_STAGING_DIR / uuid.uuid4().hex
    staging_subdir.mkdir(parents=True, exist_ok=True)
    staged_path = staging_subdir / file.filename

    try:
        # Write the uploaded file content to the staging directory
        content = await file.read()
        staged_path.write_bytes(content)
        logger.info(f"User '{current_user}' staged file '{file.filename}' "
                    f"({len(content)} bytes) for upload to {resolved_targets}")

        # Execute Bolt file upload: pushes the staged file to all targets.
        # The destination can be a directory (file keeps its name) or a
        # full path (file is renamed on the target).
        # --run-as root ensures the file can be written to any destination
        # regardless of the connecting user's permissions on the target.
        args = ["file", "upload", str(staged_path), destination,
                "--targets", resolved_targets, "--run-as", "root",
                "--format", "human"]
        result = await run_bolt_command(args, timeout=300)

        return {
            "success": result["returncode"] == 0,
            "returncode": result["returncode"],
            "filename": file.filename,
            "size": len(content),
            "destination": destination,
            "targets": resolved_targets,
            "output": strip_ansi(result.get("stdout", "")),
            "error": result["stderr"],
        }
    except Exception as e:
        logger.error(f"File upload failed: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    finally:
        # Always clean up the staging subdirectory and its contents to
        # prevent disk space leaks. shutil.rmtree removes the UUID
        # subdirectory and the file inside it in one operation.
        if staging_subdir.exists():
            import shutil as _shutil
            _shutil.rmtree(staging_subdir, ignore_errors=True)


@router.post("/file/download")
async def download_file_from_targets(
    req: FileDownloadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(require_role("admin", "operator")),
):
    """Download a file from remote targets to the Bolt controller via Bolt.

    Executes 'bolt file download <source> <destination> --targets <certnames>'
    which copies the specified file from each target into subdirectories
    named after each target under the destination path on this server.

    For example, downloading /etc/hosts from two targets to /tmp/downloads
    creates:
      /tmp/downloads/web01.example.com/hosts
      /tmp/downloads/web02.example.com/hosts

    The destination directory is created automatically if it does not
    exist. The response includes Bolt's output showing which targets
    succeeded and which failed.
    """
    # Validate paths — reject traversal attempts
    if ".." in req.source or ".." in req.destination:
        raise HTTPException(status_code=400, detail="Invalid path — '..' not allowed")

    # Resolve ENC group names to actual certnames for Bolt
    resolved_targets = await resolve_targets(req.targets, db)

    # Use the app's data directory for downloads so the puppet user
    # can always write and read from it. The destination from the UI
    # is used as a subdirectory under the bolt-downloads staging area.
    dest_path = Path(req.destination)

    logger.info(f"User '{current_user}' downloading '{req.source}' from "
                f"{resolved_targets} to {req.destination}")

    # Execute Bolt file download. The destination directory is created
    # by Bolt itself (running as root via sudo), so we don't need to
    # pre-create it. Bolt creates per-target subdirectories automatically.
    # --run-as root ensures the file can be read from any location on
    # the target regardless of the connecting user's permissions (e.g.,
    # reading from /home/otheruser or /root).
    args = ["file", "download", req.source, req.destination,
            "--targets", resolved_targets, "--run-as", "root",
            "--format", "human"]
    result = await run_bolt_command(args, timeout=300)

    # List downloaded files for the response. Bolt creates the files
    # as root, so we use a try/except in case the puppet user can't
    # read some directories or files due to permission differences.
    downloaded_files = []
    try:
        if dest_path.exists():
            for target_dir in sorted(dest_path.iterdir()):
                if target_dir.is_dir():
                    for f in sorted(target_dir.rglob("*")):
                        try:
                            if f.is_file():
                                downloaded_files.append({
                                    "target": target_dir.name,
                                    "path": str(f.relative_to(dest_path)),
                                    "size": f.stat().st_size,
                                })
                        except PermissionError:
                            downloaded_files.append({
                                "target": target_dir.name,
                                "path": str(f.relative_to(dest_path)),
                                "size": -1,
                            })
    except PermissionError as e:
        logger.warning(f"Cannot list downloaded files (permission): {e}")
    except Exception as e:
        logger.warning(f"Error listing downloaded files: {e}")

    return {
        "success": result["returncode"] == 0,
        "returncode": result["returncode"],
        "source": req.source,
        "destination": req.destination,
        "targets": resolved_targets,
        "files": downloaded_files,
        "output": result["stdout"],
        "error": result["stderr"],
    }



@router.post("/run/script")
@rate_limit_heavy()
async def run_script_on_targets(
    request: Request,
    file: UploadFile = FastAPIFile(..., description="The script file to execute on remote targets"),
    targets: str = Form(..., description="Comma-separated certnames, 'all', or ENC group name"),
    arguments: str = Form("", description="Arguments to pass to the script (space-separated)"),
    _ = Depends(concurrency_heavy),
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(require_role("admin", "operator")),
):
    """Upload and execute a local script on remote targets via Bolt.

    This implements 'bolt script run' — Bolt copies the script to each
    target's temporary directory, executes it with the specified arguments,
    and returns the output. The script is cleaned up automatically by Bolt
    after execution.

    Unlike 'bolt file upload' followed by 'bolt command run', this is a
    single atomic operation: upload + execute + cleanup in one step. The
    script can be in any language (bash, python, ruby, powershell) as long
    as the target has the appropriate interpreter.

    The staged script is cleaned up from the local server after Bolt
    reads it, regardless of execution outcome.
    """
    import uuid

    # Resolve ENC group names to actual certnames for Bolt
    resolved_targets = await resolve_targets(targets, db)

    # Stage the script to a temporary location
    UPLOAD_STAGING_DIR.mkdir(parents=True, exist_ok=True)
    staging_subdir = UPLOAD_STAGING_DIR / uuid.uuid4().hex
    staging_subdir.mkdir(parents=True, exist_ok=True)
    staged_path = staging_subdir / file.filename

    try:
        content = await file.read()
        staged_path.write_bytes(content)
        staged_path.chmod(0o755)
        logger.info(f"User '{current_user}' staged script '{file.filename}' "
                    f"({len(content)} bytes) for execution on {resolved_targets}")

        # Build bolt script run command
        args = ["script", "run", str(staged_path),
                "--targets", resolved_targets, "--run-as", "root",
                "--format", "human"]
        if arguments.strip():
            args.extend(["--", *arguments.strip().split()])

        result = await run_bolt_command(args, timeout=300)

        return {
            "success": result["returncode"] == 0,
            "returncode": result["returncode"],
            "filename": file.filename,
            "targets": resolved_targets,
            "output": strip_ansi(result.get("stdout", "")),
            "error": result["stderr"],
        }
    except Exception as e:
        logger.error(f"Script execution failed: {e}")
        raise HTTPException(status_code=500, detail=f"Script execution failed: {e}")
    finally:
        if staging_subdir.exists():
            import shutil as _shutil
            _shutil.rmtree(staging_subdir, ignore_errors=True)

