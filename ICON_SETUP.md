# Icon Setup Instructions

## Current Setup
Your app is now configured with optimized icons for each platform:
- **Windows**: `primitiv_logo_256.png` (256x256) - Optimized for Windows
- **macOS**: `primitiv_logo.png` (512x512) - High resolution for Retina displays  
- **Linux**: `primitiv_logo_256.png` (256x256) - Standard Linux application size

## Platform-Specific Icon Requirements

### Windows (.ico)
- **Format**: ICO file
- **Sizes**: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256
- **Location**: `imgs/primitiv_logo.ico`

### macOS (.icns)
- **Format**: ICNS file
- **Sizes**: 16x16, 32x32, 64x64, 128x128, 256x256, 512x512, 1024x1024
- **Location**: `imgs/primitiv_logo.icns`

### Linux (.png)
- **Format**: PNG file
- **Size**: 512x512 (your current file is perfect)
- **Location**: `imgs/primitiv_logo.png` (already exists)

## Quick Setup (Current)
Your current setup will work fine! Electron-builder will automatically convert your PNG to the required formats.

## Advanced Setup (Optional)
If you want platform-specific icons for better quality:

1. **Convert PNG to ICO** (Windows):
   - Use online converter or ImageMagick
   - Save as `imgs/primitiv_logo.ico`

2. **Convert PNG to ICNS** (macOS):
   - Use online converter or ImageMagick
   - Save as `imgs/primitiv_logo.icns`

3. **Update package.json**:
   ```json
   "win": {
     "target": "nsis",
     "icon": "imgs/primitiv_logo.ico"
   },
   "mac": {
     "target": "zip", 
     "icon": "imgs/primitiv_logo.icns"
   }
   ```

## Testing
After building, check:
- Windows: Icon in taskbar and file explorer
- macOS: Icon in dock and Applications folder
- Linux: Icon in application menu
