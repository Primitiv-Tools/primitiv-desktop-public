const { ipcRenderer } = require('electron');

// Widget elements
const widget = document.getElementById('widget');
const dragHandle = document.getElementById('dragHandle');

// State variables
let isDragging = false;

// Hover state management
let hoverTimeout;
const HOVER_DELAY = 150; // Delay before expanding

// Dropdown functionality
const dropdown = document.getElementById('dropdown');
let isDropdownOpen = false;

// Authentication service
let authService = null;

// Initialize authentication service
async function initializeAuth() {
    try {
        authService = window.desktopAuthService;
        if (!authService) {
            console.error('Auth service not available');
            return;
        }

        // Initialize auth service
        await authService.init();
        
        // Add listener for auth state changes
        authService.addListener(onAuthStateChange);
        
        console.log('Auth service initialized');
    } catch (error) {
        console.error('Error initializing auth:', error);
    }
}

// Listen for sleep timer updates
ipcRenderer.on('update-sleep-timer', (event, hours, minutes) => {
    console.log(`Sleep timer update: ${hours}:${minutes.toString().padStart(2, '0')}`);
    // You could add UI indication here if needed
});

// Listen for sleep mode end
ipcRenderer.on('sleep-mode-ended', (event) => {
    console.log('Sleep mode ended - widget fully restored');
});

// Listen for main window hidden during sleep mode
ipcRenderer.on('main-window-hidden-for-sleep', (event) => {
    console.log('Main window hidden for sleep - resetting dropdown state');
    isDropdownOpen = false;
    currentView = null;
    updateWidgetIcons();
});

// Handle authentication state changes (minimal - main window handles UI)
function onAuthStateChange(authState, user) {
    console.log('Auth state changed:', authState, user);
    // Main window handles all auth UI updates
}

// Update task icon between active and inactive states
function updateTaskIcon(isActive) {
    const taskIcon = document.querySelector('.icon-task');
    if (!taskIcon) return;

    if (isActive) {
        taskIcon.setAttribute('src', 'imgs/task_middle_active.svg');
        taskIcon.setAttribute('alt', 'Tasks Active');
    } else {
        taskIcon.setAttribute('src', 'imgs/task_middle.svg');
        taskIcon.setAttribute('alt', 'Tasks');
    }
}

function updateLogoIcon(isActive) {
    const logoIcon = document.querySelector('.icon-logo');
    if (!logoIcon) return;

    // Logo always stays the same - no active state needed
    logoIcon.setAttribute('src', 'imgs/logo_top.svg');
    logoIcon.setAttribute('alt', 'Logo');
}

// Update widget icons based on current view
function updateWidgetIcons() {
    if (currentView === 'tasks') {
        updateTaskIcon(true);
        updateLogoIcon(false);
    } else if (currentView === 'settings') {
        updateTaskIcon(false);
        updateLogoIcon(true);
    } else {
        // No view active (window closed)
        updateTaskIcon(false);
        updateLogoIcon(false);
    }
}

// Toggle dropdown with better state management
function toggleDropdown() {
    console.log('Toggle dropdown called, current state:', isDropdownOpen);
    
    if (isDropdownOpen) {
        hideDropdown();
    } else {
        showDropdown();
    }
}

// Show main window (dropdown) with state checking
async function showDropdown() {
    await showDropdownWithView('tasks'); // Default to tasks view
}

// Show main window with specific view
async function showDropdownWithView(view) {
    if (isDropdownOpen) {
        console.log('Dropdown already open, switching view to:', view);
        switchToView(view);
        return;
    }

    console.log('Opening dropdown with view:', view);
    isDropdownOpen = true;
    currentView = view;

    // Update widget icons based on view
    updateWidgetIcons();

    // Calculate optimal position for main window
    const position = await calculateMainWindowPosition();

    // Send IPC to show main window with specified view
    ipcRenderer.send('show-main-window-with-view', position.x, position.y, view);

    // Trigger sync directly on user click (only for tasks view)
    if (view === 'tasks') {
        console.log('User clicked widget - triggering sync');
        ipcRenderer.send('trigger-sync-on-click');
    }

    console.log('Showing main window at:', position.x, position.y, 'with view:', view);
}

// Switch to a different view in the already-open main window
function switchToView(view) {
    console.log('Switching to view:', view);
    currentView = view;

    // Update widget icons based on new view
    updateWidgetIcons();

    ipcRenderer.send('switch-main-window-view', view);
}

// Calculate optimal position for main window based on widget location
function calculateMainWindowPosition() {
    const widgetRect = widget.getBoundingClientRect();
    
    // Send widget position to main process for calculation
    // The main process will calculate the optimal position and return it
    return new Promise((resolve) => {
        ipcRenderer.send('calculate-main-window-position', {
            widgetRect: {
                left: widgetRect.left,
                top: widgetRect.top,
                right: widgetRect.right,
                bottom: widgetRect.bottom,
                width: widgetRect.width,
                height: widgetRect.height
            }
        });
        
        // Listen for the calculated position
        ipcRenderer.once('main-window-position-calculated', (event, position) => {
            resolve(position);
        });
    });
}

// Position function removed - now handled by main window positioning

// Hide main window (dropdown) with state checking
function hideDropdown() {
    if (!isDropdownOpen) {
        console.log('Dropdown already closed, ignoring hide request');
        return;
    }

    console.log('Closing dropdown...');
    isDropdownOpen = false;
    currentView = null; // Clear current view

    // Update widget icons (both inactive)
    updateWidgetIcons();

    ipcRenderer.send('hide-main-window');
}

// Settings window functions removed - settings now embedded in main window

// Expand/Collapse functionality
widget.addEventListener('mouseenter', () => {
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
        expandWidget();
    }, HOVER_DELAY);
});

widget.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimeout);
    // Don't collapse if we're dragging
    if (!isDragging) {
        collapseWidget();
    }
});

function expandWidget() {
    widget.classList.add('expanded');
    // Resize window to accommodate expanded widget
    updateWindowSize(54, 135);
}

function collapseWidget() {
    widget.classList.remove('expanded');
    // Resize window back to collapsed size
    updateWindowSize(54, 110);
}

function updateWindowSize(width, height) {
    // Send message to main process to update window size
    ipcRenderer.send('resize-window', width, height);
}

// Drag functionality
let dragStartX = 0;
let dragStartY = 0;

// Handle dragging only when grip is visible and mouse is down on it
dragHandle.addEventListener('mousedown', startDrag);

function startDrag(e) {
    if (!widget.classList.contains('expanded')) return;

    isDragging = true;
    widget.classList.add('dragging');

    dragStartX = e.screenX;
    dragStartY = e.screenY;

    // Prevent default to avoid text selection
    e.preventDefault();

    // Add document-level listeners for drag
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', stopDrag);
}

function drag(e) {
    if (!isDragging) return;

    const deltaX = e.screenX - dragStartX;
    const deltaY = e.screenY - dragStartY;

    // Move window using Electron API
    moveWindow(deltaX, deltaY);

    // Update main window position if it's open
    if (isDropdownOpen) {
        calculateMainWindowPosition().then(position => {
            ipcRenderer.send('show-main-window', position.x, position.y);
        });
    }

    // Settings window repositioning removed - settings now embedded in main window

    // Update start position for next move
    dragStartX = e.screenX;
    dragStartY = e.screenY;
}

function stopDrag(e) {
    if (!isDragging) return;

    isDragging = false;
    widget.classList.remove('dragging');

    // Remove document-level listeners
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('mouseup', stopDrag);

    // Check if mouse is still over widget after drag ends
    const rect = widget.getBoundingClientRect();
    const isMouseOverWidget = e.clientX >= rect.left &&
                              e.clientX <= rect.right &&
                              e.clientY >= rect.top &&
                              e.clientY <= rect.bottom;

    // If mouse is not over widget anymore, collapse it
    if (!isMouseOverWidget) {
        collapseWidget();
    }
}

// Helper function to move widget window
function moveWindow(deltaX, deltaY) {
    ipcRenderer.send('move-widget', deltaX, deltaY);
}

// Prevent default drag behavior on images
const images = document.querySelectorAll('img');
images.forEach(img => {
    img.addEventListener('dragstart', (e) => {
        e.preventDefault();
    });
});

// Click handlers with debouncing to prevent multiple clicks
const topSection = document.querySelector('.widget-top');
const middleSection = document.querySelector('.widget-middle');

// Debounce function to prevent rapid clicks
// Debounce function removed - no longer needed with direct view switching

// Track which view is currently active: 'tasks' or 'settings'
let currentView = null;

topSection.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Top section clicked - Logo - Toggling Settings View');

    if (!isDropdownOpen) {
        // Main window closed, open it with settings view
        await showDropdownWithView('settings');
    } else if (currentView === 'settings') {
        // Settings already showing, close the main window
        hideDropdown();
    } else {
        // Main window open with tasks, switch to settings
        switchToView('settings');
    }
});

middleSection.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Middle section clicked - Tasks');

    if (!isDropdownOpen) {
        // Main window closed, open it with tasks view
        showDropdownWithView('tasks');
    } else if (currentView === 'tasks') {
        // Tasks already showing, close the main window
        hideDropdown();
    } else {
        // Main window open with settings, switch to tasks
        switchToView('tasks');
    }
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (isDropdownOpen && !widget.contains(e.target)) {
        hideDropdown();
    }
});

// Authentication button handlers
document.addEventListener('click', async (e) => {
    if (e.target.matches('[data-auth-login]')) {
        console.log('Login button clicked');
        if (authService) {
            await authService.login();
        }
    }
    
    if (e.target.matches('[data-new-task]')) {
        console.log('New task button clicked');
        // Add new task functionality here
    }
    
    if (e.target.matches('[data-filter]')) {
        console.log('Filter button clicked:', e.target.dataset.filter);
        // Update active filter
        const filterButtons = document.querySelectorAll('[data-filter]');
        filterButtons.forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
    }
});

// Handle window resize - reposition windows if open
window.addEventListener('resize', () => {
    if (isDropdownOpen) {
        calculateMainWindowPosition().then(position => {
            ipcRenderer.send('show-main-window', position.x, position.y);
        });
    }
    
    // Settings window repositioning removed - settings now embedded in main window
});

// Initialize the widget when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    await initializeAuth();
});

// Listen for task icon reset from main process
ipcRenderer.on('reset-task-icon', () => {
    console.log('Received reset-task-icon message from main process');
    console.log('Resetting task icon to inactive state');
    updateTaskIcon(false);
    isDropdownOpen = false;
    console.log('Task icon reset complete, isDropdownOpen:', isDropdownOpen);
});

// Settings window IPC listeners removed - settings now embedded in main window