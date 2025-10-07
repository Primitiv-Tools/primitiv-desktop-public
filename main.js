const { app, BrowserWindow, screen, ipcMain, protocol } = require('electron');
const path = require('path');

// Prevent multiple instances - following official Electron pattern
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is already running, quitting...');
  app.quit();
} else {
  console.log('Got single instance lock, continuing...');
  
  // Handle second instance attempts - official Electron pattern
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('Second instance detected, focusing existing windows');
    
    // Focus existing windows
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.focus();
    }
    
    // Handle deep link if present
    const url = commandLine.find(arg => arg.startsWith('primitiv-desktop://'));
    if (url) {
      handleDeepLink([url]);
    }
  });
}

let widgetWindow;
let mainWindow;
// let settingsWindow; // Settings now embedded in mainWindow

// Clean up any existing widgets with better error handling
function cleanupWidgets() {
  try {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      console.log('Cleaning up existing widget');
      widgetWindow.removeAllListeners();
      widgetWindow.destroy();
      widgetWindow = null;
    }
  } catch (error) {
    console.error('Error cleaning up widget:', error);
    widgetWindow = null;
  }
}

// Clean up main window with better error handling
function cleanupMainWindow() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('Cleaning up main window');
      mainWindow.removeAllListeners();
      mainWindow.destroy();
      mainWindow = null;
    }
  } catch (error) {
    console.error('Error cleaning up main window:', error);
    mainWindow = null;
  }
}

function createWidget() {
  // Prevent multiple widget creation
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    console.log('Widget already exists, not creating another');
    return widgetWindow;
  }
  
  // Get primary display dimensions
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Widget dimensions
  const widgetWidth = 54;
  const widgetHeight = 110;

  widgetWindow = new BrowserWindow({
    width: widgetWidth,
    height: widgetHeight,
    x: width - widgetWidth - 20, // Position at middle-bottom
    y: Math.floor((height - widgetHeight) / 2),
    frame: false, // Remove window frame
    transparent: true, // Make window transparent
    alwaysOnTop: true, // Keep widget on top
    resizable: false,
    skipTaskbar: true, // Don't show in taskbar
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  widgetWindow.loadFile('widget.html');

  // Prevent window from being hidden when clicked outside
  widgetWindow.setAlwaysOnTop(true, 'floating');

  // Set minimum size to prevent issues
  widgetWindow.setMinimumSize(widgetWidth, widgetHeight);

  // Ensure widget starts within screen bounds
  ensureWidgetInBounds();

  // For development - open DevTools
  if (process.argv.includes('--dev')) {
    widgetWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// Ensure widget stays within screen bounds
function ensureWidgetInBounds() {
  if (!widgetWindow) return;
  
  const [currentX, currentY] = widgetWindow.getPosition();
  const [widgetWidth, widgetHeight] = widgetWindow.getSize();
  
  // Get screen dimensions
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  // Constrain to screen bounds with margin
  const margin = 8;
  
  let newX = currentX;
  let newY = currentY;
  let needsUpdate = false;
  
  // Check horizontal bounds
  if (currentX < margin) {
    newX = margin;
    needsUpdate = true;
  } else if (currentX + widgetWidth > screenWidth - margin) {
    newX = screenWidth - widgetWidth - margin;
    needsUpdate = true;
  }
  
  // Check vertical bounds (especially important)
  if (currentY < margin) {
    newY = margin;
    needsUpdate = true;
  } else if (currentY + widgetHeight > screenHeight - margin) {
    newY = screenHeight - widgetHeight - margin;
    needsUpdate = true;
  }
  
  // Update position if needed
  if (needsUpdate) {
    widgetWindow.setPosition(newX, newY);
    console.log(`Widget repositioned to stay within bounds: ${newX}, ${newY}`);
  }
}

function createMainWindow() {
  // Prevent multiple main window creation
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('Main window already exists, not creating another');
    return;
  }

  // Get primary display dimensions
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Main window dimensions - starting point for most laptops
  const mainWidth = 698;
  const mainHeight = 500;
  
  // Responsive bounds for different screen sizes
  const screenWidth = width;
  const screenHeight = height;
  
  // Ensure minimum viable size
  const minWidth = 400;
  const minHeight = 300;
  
  // Ensure maximum doesn't overwhelm smaller screens
  const maxWidth = Math.min(900, screenWidth * 0.8);
  const maxHeight = Math.min(700, screenHeight * 0.9);
  
  // Clamp dimensions within bounds
  const finalWidth = Math.max(minWidth, Math.min(mainWidth, maxWidth));
  const finalHeight = Math.max(minHeight, Math.min(mainHeight, maxHeight));

  mainWindow = new BrowserWindow({
    width: finalWidth,
    height: finalHeight,
    x: width - finalWidth - 20, // Position at bottom-right with 20px margin
    y: height - finalHeight - 20,
    frame: false, // Remove window frame
    transparent: true, // Make window transparent
    alwaysOnTop: true, // Keep main window on top
    resizable: true, // Allow user to resize (needed for CSS resize to work)
    minWidth: 400, // Enforce minimum dimensions
    minHeight: 300,
    maxWidth: 900, // Enforce maximum dimensions
    maxHeight: 700,
    skipTaskbar: true, // Don't show in taskbar
    show: false, // Don't show initially
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  mainWindow.loadFile('main.html');

  // Reposition widget when main window is resized or moved
  mainWindow.on('resize', () => {
    repositionWidgetRelativeToMain();
  });

  // For development - open DevTools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// Reposition widget relative to main window
function repositionWidgetRelativeToMain() {
  if (!mainWindow || mainWindow.isDestroyed() || !widgetWindow || widgetWindow.isDestroyed()) {
    return;
  }

  const [mainX, mainY] = mainWindow.getPosition();
  const [mainWidth, mainHeight] = mainWindow.getSize();
  const [widgetWidth, widgetHeight] = widgetWindow.getSize();
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  // Determine which quadrant the main window is in
  const mainCenterX = mainX + mainWidth / 2;
  const mainCenterY = mainY + mainHeight / 2;
  const mainInRightHalf = mainCenterX > screenWidth / 2;
  const mainInBottomHalf = mainCenterY > screenHeight / 2;

  let newWidgetX, newWidgetY;
  const margin = 20;

  // Position widget opposite to main window's quadrant
  if (mainInRightHalf && mainInBottomHalf) {
    // Main is bottom-right, widget goes top-left of main
    newWidgetX = mainX - widgetWidth - margin;
    newWidgetY = mainY;
  } else if (!mainInRightHalf && mainInBottomHalf) {
    // Main is bottom-left, widget goes top-right of main
    newWidgetX = mainX + mainWidth + margin;
    newWidgetY = mainY;
  } else if (mainInRightHalf && !mainInBottomHalf) {
    // Main is top-right, widget goes bottom-left of main
    newWidgetX = mainX - widgetWidth - margin;
    newWidgetY = mainY + mainHeight - widgetHeight;
  } else {
    // Main is top-left, widget goes bottom-right of main
    newWidgetX = mainX + mainWidth + margin;
    newWidgetY = mainY + mainHeight - widgetHeight;
  }

  // Ensure widget stays within screen bounds
  newWidgetX = Math.max(margin, Math.min(screenWidth - widgetWidth - margin, newWidgetX));
  newWidgetY = Math.max(margin, Math.min(screenHeight - widgetHeight - margin, newWidgetY));

  widgetWindow.setPosition(newWidgetX, newWidgetY);
}



// Handle IPC for window movement (widget)
ipcMain.on('move-widget', (event, deltaX, deltaY) => {
  const [currentX, currentY] = widgetWindow.getPosition();
  const [widgetWidth, widgetHeight] = widgetWindow.getSize();
  
  // Get screen dimensions
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  // Calculate new position
  let newX = currentX + deltaX;
  let newY = currentY + deltaY;
  
  // Constrain to screen bounds with margin
  const margin = 8; // Keep widget at least 8px from screen edges
  
  // Horizontal bounds
  newX = Math.max(margin, Math.min(newX, screenWidth - widgetWidth - margin));
  
  // Vertical bounds (especially important)
  newY = Math.max(margin, Math.min(newY, screenHeight - widgetHeight - margin));
  
  // Only move if position actually changed (prevents unnecessary updates)
  if (newX !== currentX || newY !== currentY) {
    widgetWindow.setPosition(newX, newY);
  }
});

// Handle IPC for window movement (main window) - delta-based (legacy)
ipcMain.on('move-main-window', (event, deltaX, deltaY) => {
  const [currentX, currentY] = mainWindow.getPosition();
  
  // Get screen dimensions
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  // Calculate new position
  let newX = currentX + deltaX;
  let newY = currentY + deltaY;
  
  // Constrain to screen bounds with margin
  const margin = 20; // Keep main window at least 20px from screen edges
  
  // Horizontal bounds
  newX = Math.max(margin, Math.min(newX, screenWidth - mainWindow.getSize()[0] - margin));
  
  // Vertical bounds (especially important)
  newY = Math.max(margin, Math.min(newY, screenHeight - mainWindow.getSize()[1] - margin));
  
  // Only move if position actually changed (prevents unnecessary updates)
  if (newX !== currentX || newY !== currentY) {
    mainWindow.setPosition(newX, newY);
    // Reposition widget relative to main window after main window moves
    repositionWidgetRelativeToMain();
  }
});

// Handle IPC for window movement (main window) - absolute position (stable dragging)
ipcMain.on('move-main-window-absolute', (event, newX, newY) => {
  // Get screen dimensions
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const [currentWidth, currentHeight] = mainWindow.getSize();
  
  // Constrain to screen bounds with margin
  const margin = 20; // Keep main window at least 20px from screen edges
  
  // Horizontal bounds
  const constrainedX = Math.max(margin, Math.min(newX, screenWidth - currentWidth - margin));
  
  // Vertical bounds (especially important)
  const constrainedY = Math.max(margin, Math.min(newY, screenHeight - currentHeight - margin));
  
  // Only move if position actually changed (prevents unnecessary updates)
  const [currentX, currentY] = mainWindow.getPosition();
  if (constrainedX !== currentX || constrainedY !== currentY) {
    mainWindow.setPosition(constrainedX, constrainedY);
    // Reposition widget relative to main window after main window moves
    repositionWidgetRelativeToMain();
  }
});

// Handle IPC for getting window position (for stable dragging)
ipcMain.on('get-window-position', (event) => {
  const [x, y] = mainWindow.getPosition();
  event.reply('window-position', x, y);
});

// Handle IPC for calculating main window position
ipcMain.on('calculate-main-window-position', async (event, data) => {
  const { widgetRect } = data;
  
  // Get actual main window dimensions from the DOM
  let mainWindowWidth = 698; // Default fallback
  let mainWindowHeight = 500; // Default fallback
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const dimensions = await mainWindow.webContents.executeJavaScript(`
        (() => {
          const mainContent = document.querySelector('.main-content');
          if (mainContent) {
            return {
              width: mainContent.offsetWidth,
              height: mainContent.offsetHeight
            };
          }
          return { width: 698, height: 500 };
        })();
      `);
      mainWindowWidth = dimensions.width || 698;
      mainWindowHeight = dimensions.height || 500;
    } catch (error) {
      console.log('Could not get main window dimensions:', error);
    }
  }
  
  const gap = 12; // Always maintain this gap between widget and main window
  
  // Get widget window position on screen
  const widgetWindowPos = widgetWindow.getPosition();
  
  // Calculate widget's absolute position on screen
  const widgetScreenX = widgetWindowPos[0] + widgetRect.left;
  const widgetScreenY = widgetWindowPos[1] + widgetRect.top;
  const widgetScreenRight = widgetScreenX + widgetRect.width;
  const widgetScreenBottom = widgetScreenY + widgetRect.height;
  
  // Get screen dimensions
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  // Simple logic: always try to position to the side, never above/below
  let x, y, positionClass;
  
  // Check if there's enough space to the right
  const spaceRight = screenWidth - widgetScreenRight - gap;
  const spaceLeft = widgetScreenX - gap;
  
  if (spaceRight >= mainWindowWidth) {
    // Position to the right
    positionClass = 'position-right';
    x = widgetScreenRight + gap;
    y = widgetScreenY; // Align with widget top
  } else if (spaceLeft >= mainWindowWidth) {
    // Position to the left
    positionClass = 'position-left';
    x = widgetScreenX - mainWindowWidth - gap;
    y = widgetScreenY; // Align with widget top
  } else {
    // Not enough space on either side, position to the right but adjust vertically
    positionClass = 'position-right-adjusted';
    x = widgetScreenRight + gap;
    
    // Adjust Y position to keep main window within screen bounds
    if (widgetScreenY + mainWindowHeight > screenHeight) {
      y = screenHeight - mainWindowHeight - gap;
    } else {
      y = widgetScreenY;
    }
  }
  
  // Final bounds check - ensure main window stays within screen
  x = Math.max(gap, Math.min(x, screenWidth - mainWindowWidth - gap));
  y = Math.max(gap, Math.min(y, screenHeight - mainWindowHeight - gap));
  
  // Send the calculated position back to the renderer
  event.reply('main-window-position-calculated', { x, y, class: positionClass });
});

// Settings window position calculation no longer needed - settings embedded in mainWindow
// ipcMain.on('calculate-settings-window-position', async (event, data) => {
//   // Settings now shown as overlay in mainWindow
// });

// Handle IPC for showing main window
ipcMain.on('show-main-window', (event, x, y) => {
  // Settings window no longer used - settings embedded in mainWindow
  // if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) {
  //   settingsWindow.hide();
  // }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setPosition(x, y);
    mainWindow.show();
    mainWindow.focus();

    // Notify mainWindow that it was shown (for positioning only, no sync)
    mainWindow.webContents.send('main-window-shown');
  } else {
    console.log('Main window does not exist or is destroyed, cannot show');
  }
});

// Handle IPC for triggering sync on user click
ipcMain.on('trigger-sync-on-click', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Send sync trigger directly to main window
    mainWindow.webContents.send('trigger-sync-on-click');
  } else {
    console.log('Main window does not exist, cannot trigger sync');
  }
});

// Handle IPC for hiding main window
ipcMain.on('hide-main-window', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

// Handle IPC for moving main window
ipcMain.on('move-main-window', (event, deltaX, deltaY) => {
  if (mainWindow) {
    const [currentX, currentY] = mainWindow.getPosition();
    mainWindow.setPosition(currentX + deltaX, currentY + deltaY);
  }
});

// Handle IPC for resizing widget window
ipcMain.on('resize-window', (event, width, height) => {
  if (widgetWindow) {
    widgetWindow.setSize(width, height);
  }
});


// Handle IPC for opening dashboard
ipcMain.on('open-dashboard', () => {
  const { shell } = require('electron');
  shell.openExternal('https://primitiv.tools/dashboard');
});

// Handle IPC for exiting the app
ipcMain.on('exit-app', () => {
  console.log('Exit app requested by user');
  
  // Stop any running sleep timers
  if (sleepTimer) {
    clearInterval(sleepTimer);
    sleepTimer = null;
  }
  
  // Clean up all windows properly
  cleanupWidgets();
  cleanupMainWindow();
  
  // Use standard quit - Electron will handle cleanup
  app.quit();
});

// Handle IPC for updating auth state after logout
ipcMain.on('update-auth-state-after-logout', () => {
  console.log('Auth state update requested after logout');
  
  // Notify main window to update its authentication state
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth-state-changed-after-logout');
  }
});

// Sleep functionality
let sleepTimer = null;
let isSleeping = false;

// Handle IPC for sleep mode
ipcMain.on('start-sleep-mode', (event, hours, minutes) => {
  if (isSleeping) {
    console.log('Already in sleep mode');
    return;
  }

  let totalMinutes = (hours * 60) + minutes;
  console.log(`Starting sleep mode for ${hours}:${minutes.toString().padStart(2, '0')} (${totalMinutes} minutes)`);
  
  isSleeping = true;
  
  // Set widget opacity to reduced visibility (sleep mode)
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.setOpacity(0.7);
  }
  
  // Hide main window during sleep mode
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  
  // Notify widget that main window is hidden (reset dropdown state)
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('main-window-hidden-for-sleep');
  }
  
  // Start countdown timer (update every minute)
  sleepTimer = setInterval(() => {
    if (totalMinutes > 0) {
      totalMinutes--;
      const remainingHours = Math.floor(totalMinutes / 60);
      const remainingMinutes = totalMinutes % 60;
      
      // Send updated time to mainWindow and widget
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-sleep-timer', remainingHours, remainingMinutes);
      }

      if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.webContents.send('update-sleep-timer', remainingHours, remainingMinutes);
      }
    } else {
      // Wake up!
      wakeUp();
    }
  }, 60000); // Update every minute
  
  // Initial timer value
  const remainingHours = hours;
  const remainingMinutes = minutes;
  
  // Send initial timer to mainWindow and widget
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-sleep-timer', remainingHours, remainingMinutes);
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('update-sleep-timer', remainingHours, remainingMinutes);
  }
});

// Handle IPC for waking up
ipcMain.on('wake-up', () => {
  wakeUp();
});

function wakeUp() {
  console.log('Waking up from sleep mode');
  
  isSleeping = false;
  
  // Clear sleep timer
  if (sleepTimer) {
    clearInterval(sleepTimer);
    sleepTimer = null;
  }
  
  // Restore widget opacity
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.setOpacity(1.0);
  }
  
  // Show main window when waking up
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
  
  // Send wake up message to windows
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sleep-mode-ended');
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('sleep-mode-ended');
  }
}


// Handle IPC for showing main window with specific view
ipcMain.on('show-main-window-with-view', (event, x, y, view) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setPosition(x, y);
    mainWindow.show();
    mainWindow.focus();

    // Notify widget that dropdown is now visible
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send('dropdown-shown');
    }

    // Send view to main window
    mainWindow.webContents.send('show-main-window-with-view', view);
  }
});

// Handle IPC for switching view in main window
ipcMain.on('switch-main-window-view', (event, view) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Send view switch to main window
    mainWindow.webContents.send('switch-main-window-view', view);
  }
});

// Register deep link protocol for authentication
function registerDeepLinkProtocol() {
  const PROTOCOL_SCHEME = 'primitiv-desktop';
  
  if (process.defaultApp) {
    // Development mode: Register protocol to launch Electron with the main script
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(
        PROTOCOL_SCHEME,
        process.execPath,
        [path.resolve(process.argv[1])]
      );
      console.log('Deep link protocol registered for development mode');
    }
  } else {
    // Production mode: Simple registration
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
    console.log('Deep link protocol registered for production mode');
  }

  // Note: second-instance handling is done at the top of the file

  // Handle deep link when app is launched with protocol (macOS)
  app.on('open-url', (event, url) => {
    console.log('Open URL event received:', url);
    event.preventDefault();
    handleDeepLink([url]);
  });
}

// Handle deep link authentication
function handleDeepLink(commandLine) {
  console.log('handleDeepLink called with:', commandLine);
  const url = commandLine.find(arg => arg.startsWith('primitiv-desktop://'));
  if (!url) {
    console.log('No deep link found in command line:', commandLine);
    return;
  }

  console.log('Deep link received:', url);
  
  try {
    const urlObj = new URL(url);
    console.log('Parsed URL - hostname:', urlObj.hostname);
    console.log('Parsed URL - pathname:', urlObj.pathname);
    console.log('Parsed URL - searchParams:', Object.fromEntries(urlObj.searchParams));
    
    // Check if this is an auth-success URL (either in hostname or pathname)
    const isAuthSuccess = urlObj.hostname === 'auth-success' || 
                         urlObj.pathname === '/auth-success' || 
                         urlObj.pathname === '/auth-success/';
    
    if (isAuthSuccess) {
      const accessToken = urlObj.searchParams.get('access_token');
      const refreshToken = urlObj.searchParams.get('refresh_token');
      const userData = urlObj.searchParams.get('user_data');
      
      if (accessToken && refreshToken) {
        console.log('Token authentication via deep link');
        
        // Ensure main window is focused
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.focus();
          
          // Send auth data to renderer process
          const authData = {
            accessToken,
            refreshToken,
            userData: userData ? JSON.parse(decodeURIComponent(userData)) : null
          };
          
          console.log('Sending auth data to renderer:', authData);
          mainWindow.webContents.send('auth-completed', authData);
        }
      }
    } else if (urlObj.pathname === '/auth-error') {
      const error = urlObj.searchParams.get('error');
      console.log('Authentication failed via deep link:', error);
      
      // Send error to renderer process
      if (mainWindow) {
        mainWindow.webContents.send('auth-error', { error });
      }
    }
  } catch (error) {
    console.error('Error handling deep link:', error);
  }
}

app.whenReady().then(() => {
  // Register deep link protocol first
  registerDeepLinkProtocol();
  
  // Clean up any existing widgets first
  cleanupWidgets();

  createWidget();
  createMainWindow();
  // createSettingsWindow(); // Settings now embedded in mainWindow
  
  // Ensure widget stays in bounds when screen changes
  screen.on('display-metrics-changed', () => {
    ensureWidgetInBounds();
  });
});

app.on('window-all-closed', () => {
  console.log('All windows closed');
  
  // Clean up all windows
  cleanupWidgets();
  cleanupMainWindow();
  
  // Stop any running timers
  if (sleepTimer) {
    clearInterval(sleepTimer);
    sleepTimer = null;
  }
  
  // Standard Electron pattern - quit on non-macOS platforms
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  console.log('App activate event triggered');
  
  // Only create windows if none exist
  const existingWindows = BrowserWindow.getAllWindows();
  console.log('Existing windows count:', existingWindows.length);
  
  if (existingWindows.length === 0) {
    console.log('No windows exist, creating widget and main window');
    createWidget();
    createMainWindow();
  } else {
    console.log('Windows already exist, focusing existing windows');
    // Focus existing windows instead of creating new ones
    existingWindows.forEach(window => {
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
    });
    
    // Ensure widget exists but don't create duplicate
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      console.log('Widget missing, recreating');
      createWidget();
    } else {
      console.log('Widget already exists, not creating duplicate');
    }
  }
});

// Clean up on app quit - standard Electron pattern
app.on('before-quit', () => {
  console.log('App is quitting, cleaning up resources');
  
  // Clean up all windows
  cleanupWidgets();
  cleanupMainWindow();
  
  // Stop any running timers
  if (sleepTimer) {
    clearInterval(sleepTimer);
    sleepTimer = null;
  }
});
