# OpenVox GUI Project Instructions

## Branching Strategy
- **Default branch is `main`** — staging branch has been removed
- All development and releases go through `main`

## Tag Policy
- All tags **must** point to the current HEAD of `main`
- A GitHub Actions workflow (`.github/workflows/enforce-tags.yml`) automatically rejects tags created on other commits or branches
- Use annotated tags (`git tag -a vX.Y.Z`) from a clean `main` branch only
- Releases are created from tags on `main` only
