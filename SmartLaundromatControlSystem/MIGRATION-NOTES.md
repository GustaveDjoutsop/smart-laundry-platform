# Project Structure Migration Notes

**Date**: 2025-12-10
**Migration**: Moved all files from `laundry-backend/` subfolder to repository root

## What Changed

### Before
```
SmartLaundromatControlSystem/
├── .git/
├── .claude/
└── laundry-backend/
    ├── src/
    ├── .github/
    ├── package.json
    ├── docker-compose.yml
    └── ... (all project files)
```

### After
```
SmartLaundromatControlSystem/
├── .git/
├── .claude/
├── src/
├── .github/
├── package.json
├── docker-compose.yml
└── ... (all project files at root)
```

## Why This Change?

The `laundry-backend` subfolder was unnecessary and made the project structure more complex. Moving everything to the root simplifies:
- ✅ Easier navigation
- ✅ Shorter paths
- ✅ Standard repository structure
- ✅ Simpler commands
- ✅ Better IDE integration

## Files Moved

All files and directories from `laundry-backend/` have been moved to the root:

- **Source code**: `src/`
- **Configuration**: `package.json`, `docker-compose.yml`, `Dockerfile`
- **Documentation**: All `.md` files
- **GitHub Actions**: `.github/workflows/`
- **Environment files**: `.env*` files
- **Dependencies**: `node_modules/`
- **MQTT config**: `mosquitto/`

## Documentation Updated

The following files were updated to reflect the new structure:

1. **CONFIGURATION.md** - File structure diagram updated
2. **SETUP-GUIDE.md** - Clone command updated (removed `/laundry-backend`)
3. **README.md** - All `cd laundry-backend` changed to `cd SmartLaundromatControlSystem`

## What Stayed the Same

### Docker
- Container names: `laundry-backend`, `laundry-mongodb`, `laundry-mqtt` (unchanged)
- All Docker commands work exactly the same
- `docker-compose up` still works

### GitHub Actions
- All workflows work without changes
- Workflows use relative paths (no changes needed)
- Docker image names unchanged

### Application Code
- All relative imports work the same
- `src/` directory structure unchanged
- No code changes required

## Testing Completed

✅ **Docker Configuration**: `docker-compose config` passed
✅ **File Structure**: All files verified in new location
✅ **Documentation**: All path references updated
✅ **GitHub Workflows**: No changes needed (use relative paths)
✅ **Package.json**: Scripts work with relative paths

## Commands (No Change Required)

All commands work exactly the same from the new root directory:

```bash
# Development
npm install
npm run dev
npm test

# Docker
docker-compose up
docker-compose down
docker-compose logs -f

# Git
git add .
git commit -m "message"
git push
```

## For Team Members

If you already have the repository cloned:

### Option 1: Fresh Clone (Recommended)
```bash
cd ..
rm -rf SmartLaundromatControlSystem
git clone <repo-url>
cd SmartLaundromatControlSystem
npm install
```

### Option 2: Pull Changes
```bash
cd SmartLaundromatControlSystem
git pull origin feature/sprint3

# You'll now be in the root, not laundry-backend/
npm install  # Reinstall dependencies
```

## What to Watch For

### ⚠️ If you have local changes

If you had uncommitted changes in `laundry-backend/`, they may have been lost during the migration. Make sure to:
1. Check `git status` after pulling
2. Verify your `.env` file is present
3. Reinstall dependencies: `npm install`

### ⚠️ If you have scripts that reference paths

If you have any custom scripts or commands that referenced `laundry-backend/`, update them:
```bash
# Old
cd ~/projects/SmartLaundromatControlSystem/laundry-backend

# New
cd ~/projects/SmartLaundromatControlSystem
```

### ⚠️ IDE / Editor Settings

Some IDEs may have workspace settings pointing to `laundry-backend/`:
- **VS Code**: Check `.vscode/` settings
- **IntelliJ/WebStorm**: Update project root
- **Git GUI clients**: May need to refresh

## Benefits

### Before Migration
```bash
git clone <repo>
cd SmartLaundromatControlSystem
cd laundry-backend  # Extra step!
npm install
docker-compose up
```

### After Migration
```bash
git clone <repo>
cd SmartLaundromatControlSystem
npm install
docker-compose up
```

**Saved**: One directory level, cleaner structure! ✨

## Rollback (If Needed)

If for any reason you need to rollback:

```bash
# Create laundry-backend directory
mkdir laundry-backend

# Move files back
mv src laundry-backend/
mv .github laundry-backend/
mv package.json laundry-backend/
# ... (move all files)

# Update documentation paths back
# This is not recommended - the new structure is better!
```

## Questions?

If you encounter any issues:
1. Check this document first
2. Verify you're in the repository root: `pwd`
3. Check file structure: `ls -la`
4. Reinstall dependencies: `npm install`
5. Ask in team chat if problems persist

---

**Migration completed successfully!** 🎉
All systems operational with the new structure.
