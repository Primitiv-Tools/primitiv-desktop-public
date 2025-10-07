const { ipcRenderer } = require('electron');
const DesktopApiClient = require('./apiClient');

// Main window elements
const dropdown = document.getElementById('dropdown');

// Dragging functionality
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let initialWindowX = 0;
let initialWindowY = 0;
let justFinishedDragging = false;

// Initialize dragging functionality
function initializeDragging() {
    const draggableArea = document.querySelector('[data-draggable-area]');
    if (!draggableArea) {
        console.warn('Draggable area not found');
        return;
    }

    draggableArea.addEventListener('mousedown', handleDragStart);
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    
    // Listen for window position response
    ipcRenderer.on('window-position', (event, x, y) => {
        initialWindowX = x;
        initialWindowY = y;
    });
}

// Handle drag start
function handleDragStart(event) {
    isDragging = true;
    dragStartX = event.screenX;
    dragStartY = event.screenY;
    
    // Get initial window position for stable dragging
    ipcRenderer.send('get-window-position');
    
    // Prevent text selection and event propagation during drag
    event.preventDefault();
    event.stopPropagation();
}

// Handle drag move
function handleDragMove(event) {
    if (!isDragging) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    // Calculate delta from initial mouse position (stable dragging)
    const deltaX = event.screenX - dragStartX;
    const deltaY = event.screenY - dragStartY;
    
    // Calculate new absolute position relative to initial window position
    const newX = initialWindowX + deltaX;
    const newY = initialWindowY + deltaY;
    
    // Send movement command to main process with absolute position
    ipcRenderer.send('move-main-window-absolute', newX, newY);
}

// Handle drag end
function handleDragEnd(event) {
    if (!isDragging) return;
    
    isDragging = false;
    justFinishedDragging = true;
    
    // Prevent the click event from propagating to global handlers
    event.preventDefault();
    event.stopPropagation();
    
    // Small delay to ensure this event is processed before any click events
    setTimeout(() => {
        justFinishedDragging = false;
    }, 100);
}

// Authentication service and API client
let authService = null;
let apiClient = null;

// Initialize authentication service
async function initializeAuth() {
    console.log('🚀 Main window initializeAuth called');
    try {
        authService = window.desktopAuthService;
        console.log('🚀 Auth service found:', !!authService);
        if (!authService) {
            console.error('Auth service not available');
            return;
        }

        // Initialize auth service
        await authService.init();
        console.log('🚀 Auth service initialized, adding listener');
        
        // Initialize API client
        apiClient = new DesktopApiClient(authService);
        
        // Add listener for auth state changes
        authService.addListener(onAuthStateChange);
        console.log('🚀 Main window listener added');
        
        // Update UI with current auth state
        updateAuthState();
        
        // Listen for auth state changes after logout
        listenForAuthUpdates();
        
        console.log('🚀 Main window auth service and API client initialized');
    } catch (error) {
        console.error('Error initializing auth:', error);
    }
}

// Handle authentication state changes
function onAuthStateChange(authState, user) {
    console.log('🔄 Main window received auth state change - State:', authState, 'User:', user ? 'Present' : 'None');
    updateAuthState();
}

// Listen for auth updates from IPC
function listenForAuthUpdates() {
    ipcRenderer.on('auth-state-changed-after-logout', () => {
        console.log('Received logout notification - updating main window auth state');
        
        // Force update the authentication state
        updateAuthState();
        
        // Clear any cached task data
        clearTaskData();
    });
}

// Clear cached task data after logout
function clearTaskData() {
    const taskList = dropdown.querySelector('[data-task-list]');
    if (taskList) {
        const taskItems = taskList.querySelector('[data-task-items]');
        if (taskItems) {
            taskItems.innerHTML = '';
        }
        
        // Show empty state
        const emptyState = taskList.querySelector('[data-empty-state]');
        const listContent = taskList.querySelector('[data-list-content]');
        if (emptyState) {
            emptyState.classList.add('active');
        }
        if (listContent) {
            listContent.style.display = 'none';
        }
        taskList.classList.add('empty');
    }
    
    // Reset task count
    updateTaskCount(null, 'pending');
}

// Update authentication state in UI
function updateAuthState() {
    console.log('🎯 updateAuthState called');
    if (!authService || !dropdown) {
        console.log('🎯 updateAuthState skipped - AuthService:', !!authService, 'Dropdown:', !!dropdown);
        return;
    }

    const authState = authService.getAuthState();
    const user = authService.getUser();
    console.log('🎯 Current auth state:', authState, 'User:', user ? 'Present' : 'None');

    // Hide all auth states
    const authStates = dropdown.querySelectorAll('[data-auth-state]');
    console.log('🎯 Found auth states:', authStates.length);
    authStates.forEach(state => {
        console.log('🎯 Removing active from:', state.dataset.authState);
        state.classList.remove('active');
    });

    // Show the active state
    const activeState = dropdown.querySelector(`[data-auth-state="${authState}"]`);
    console.log('🎯 Looking for active state:', authState, 'Found:', !!activeState);
    if (activeState) {
        console.log('🎯 Adding active to:', authState);
        activeState.classList.add('active');
    }

    // Update user data if authenticated
    if (authState === 'authenticated' && user) {
        console.log('🎯 User authenticated, updating profile and loading tasks');
        updateUserProfile(user);
        // Load tasks when authenticated
        loadTasks();
    } else if (authState === 'unauthenticated') {
        console.log('🎯 User unauthenticated, clearing tasks and profile');
        // Clear task data when logged out
        clearTaskData();
        // Clear user profile
        clearUserProfile();
    }
}

// Sync throttling variables
let lastSyncTime = 0;
const SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown
let syncInProgress = false;

// Trigger one-time sync and RICU recalculation when main window opens
async function triggerSyncOnOpen() {
    try {
        if (!apiClient || !authService?.isAuthenticated()) {
            console.log('Cannot trigger sync - not authenticated or API client not available');
            return;
        }

        // Prevent multiple simultaneous syncs
        if (syncInProgress) {
            console.log('Sync already in progress, skipping');
            return;
        }

        // Check cooldown period
        const now = Date.now();
        const timeSinceLastSync = now - lastSyncTime;
        if (timeSinceLastSync < SYNC_COOLDOWN_MS) {
            const remainingCooldown = Math.ceil((SYNC_COOLDOWN_MS - timeSinceLastSync) / 1000);
            console.log(`Sync skipped - ${remainingCooldown}s remaining in cooldown period`);
            return;
        }

        syncInProgress = true;
        lastSyncTime = now;

        console.log('Triggering one-time sync and RICU recalculation on main window open (respects timing check)');

        // Show syncing indicator
        showSyncingIndicator();

        // Trigger both in parallel (one-time, no recurring, respects 15-minute check)
        const [syncResult, ricuResult] = await Promise.allSettled([
            apiClient.triggerAllSourcesSync(false), // false = not forced, respects timing
            apiClient.triggerRICURecalculation(false)
        ]);

        let shouldReload = false;

        if (syncResult.status === 'fulfilled') {
            const response = syncResult.value;
            if (response.data?.skippedDueToTiming) {
                console.log(`Source sync skipped - last synced ${response.data.lastSyncMinutesAgo} minutes ago`);
            } else {
                console.log('One-time source sync triggered:', response);
                shouldReload = true; // Sync was triggered, should reload
            }
        } else {
            console.error('Source sync failed:', syncResult.reason);
        }

        if (ricuResult.status === 'fulfilled') {
            console.log('One-time RICU recalculation triggered:', ricuResult.value);
            shouldReload = true; // RICU was triggered, should reload
        } else {
            console.error('RICU recalculation failed:', ricuResult.reason);
        }

        // Wait a bit for the jobs to process, then reload tasks
        if (shouldReload) {
            // Poll for completion (check every 2 seconds, max 30 seconds)
            await waitForSyncCompletion();

            // Reload tasks after sync completes
            const activeFilter = document.querySelector('.filter-btn.active');
            const filterStatus = activeFilter ? activeFilter.dataset.filter : 'pending';
            await loadTasks(filterStatus);
        }

        // Hide syncing indicator
        hideSyncingIndicator();
    } catch (error) {
        console.error('Failed to trigger sync on open:', error);
        hideSyncingIndicator();
    } finally {
        // Always reset the sync progress flag
        syncInProgress = false;
    }
}

// Show syncing indicator
function showSyncingIndicator() {
    const taskList = document.querySelector('[data-task-list]');
    if (!taskList) return;

    // Create syncing indicator if it doesn't exist
    let syncingIndicator = taskList.querySelector('.syncing-indicator');
    if (!syncingIndicator) {
        syncingIndicator = document.createElement('div');
        syncingIndicator.className = 'syncing-indicator';
        syncingIndicator.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            gap: 12px;
            background: #f8f9fa;
            border-radius: 8px;
            margin-bottom: 12px;
        `;
        syncingIndicator.innerHTML = `
            <div class="syncing-spinner" style="
                width: 20px;
                height: 20px;
                border: 2px solid #e0e0e0;
                border-top-color: #007AFF;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            "></div>
            <span style="color: #666; font-size: 14px; font-weight: 500;">Syncing tasks...</span>
        `;

        // Add to top of list content
        const listContent = taskList.querySelector('[data-list-content]');
        if (listContent) {
            listContent.insertBefore(syncingIndicator, listContent.firstChild);
        }
    }

    syncingIndicator.style.display = 'flex';
}

// Hide syncing indicator
function hideSyncingIndicator() {
    const syncingIndicator = document.querySelector('.syncing-indicator');
    if (syncingIndicator) {
        syncingIndicator.style.display = 'none';
    }
}

// Wait for sync completion (poll backend for job status)
async function waitForSyncCompletion() {
    const maxWaitTime = 30000; // 30 seconds max
    const pollInterval = 2000; // Check every 2 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
        // Wait for poll interval
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        // TODO: Could add API call here to check job status if needed
        // For now, just wait a fixed amount of time
        if (Date.now() - startTime > 15000) {
            // After 15 seconds, assume it's done enough to show results
            break;
        }
    }
}

// Update user profile in authenticated state
function updateUserProfile(userData) {
    const userInitials = document.querySelector('.user-initials');
    const userName = document.querySelector('.user-name');
    const userEmail = document.querySelector('.user-email');

    if (userInitials && userData.name) {
        const initials = userData.name.split(' ').map(n => n[0]).join('').toUpperCase();
        userInitials.textContent = initials;
    }

    if (userName && userData.name) {
        userName.textContent = userData.name;
    }

    if (userEmail && userData.email) {
        userEmail.textContent = userData.email;
    }
}

// Clear user profile data
function clearUserProfile() {
    const userInitials = document.querySelector('.user-initials');
    const userName = document.querySelector('.user-name');
    const userEmail = document.querySelector('.user-email');

    if (userInitials) {
        userInitials.textContent = '';
    }

    if (userName) {
        userName.textContent = '';
    }

    if (userEmail) {
        userEmail.textContent = '';
    }
}

// Handle clicks outside to close window
document.addEventListener('click', (e) => {
    // Don't close window if we're in the middle of a drag operation or just finished dragging
    if (isDragging || justFinishedDragging) return;
    
    // If click is outside the dropdown content, close the window
    if (!dropdown.contains(e.target)) {
        ipcRenderer.send('hide-main-window');
    }
});

// Handle escape key to close window
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        ipcRenderer.send('hide-main-window');
    }
});

// Authentication button handlers
document.addEventListener('click', async (e) => {
    if (e.target.matches('[data-auth-login]')) {
        console.log('Login button clicked in main window');
        if (authService) {
            await authService.login();
        }
    }

    // Handle manual link click if browser didn't open
    if (e.target.matches('[data-auth-link]')) {
        e.preventDefault();
        console.log('Manual auth link clicked');
        if (authService) {
            await authService.openLoginUrl();
        }
    }
});

// Listen for deep link authentication events from main process
ipcRenderer.on('auth-completed', async (event, authData) => {
    console.log('Deep link authentication received:', authData);
    console.log('Auth service available:', !!authService);
    if (authService) {
        console.log('Calling handleDeepLinkAuth...');
        const success = await authService.handleDeepLinkAuth(authData);
        if (success) {
            console.log('Authentication completed successfully');
        } else {
            console.log('Authentication failed');
        }
    } else {
        console.log('Auth service not available');
    }
});

ipcRenderer.on('auth-error', (event, error) => {
    console.log('Received auth error from deep link:', error);
    if (authService) {
        authService.handleDeepLinkError(error);
    }
});

// Initialize the main window when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    await initializeAuth();
    setupTaskFilters();
    setupRefreshButton();
    setupSearchInput();
    setupNewTaskView();
    setupTaskDetailView();
    initializeDragging();
    setupSettings();
});

// Listen for main window being shown (for positioning only)
ipcRenderer.on('main-window-shown', async () => {
    console.log('Main window shown - positioning only, no sync');
    // No sync trigger - just window positioning
});

// Listen for sync trigger from user click
ipcRenderer.on('trigger-sync-on-click', async () => {
    console.log('Sync triggered by user click');
    
    // Trigger sync directly on user action
    if (apiClient && authService?.isAuthenticated()) {
        await triggerSyncOnOpen();
    }
});

// Task loading and management functions
async function loadTasks(filterStatus = 'pending') {
    try {
        if (!apiClient || !authService?.isAuthenticated()) {
            console.log('Cannot load tasks - not authenticated or API client not available');
            return;
        }

        console.log('Loading tasks with filter:', filterStatus);
        
        // Show loading state
        const taskList = document.querySelector('[data-task-list]');
        if (taskList) {
            const listContent = taskList.querySelector('[data-list-content]');
            const emptyState = taskList.querySelector('[data-empty-state]');
            const loadingState = taskList.querySelector('[data-loading-state]');
            
            if (listContent) listContent.style.display = 'none';
            if (emptyState) emptyState.style.display = 'none';
            if (loadingState) loadingState.style.display = 'flex';
        }

        // Build request parameters
        const requestParams = { limit: 50 };
        if (filterStatus === 'completed') {
            requestParams.status = 'completed';
        } else {
            requestParams.status = 'pending';
        }

        const response = await apiClient.getTasks(requestParams);
        const tasks = response.data?.tasks || [];
        
        console.log('Loaded tasks:', tasks.length);
        
        // Render tasks
        renderTasks(tasks, filterStatus);
        
        // Update task count
        updateTaskCount(tasks.length, filterStatus);
        
    } catch (error) {
        console.error('Failed to load tasks:', error);
        // Show empty state on error
        renderTasks([], filterStatus);
        updateTaskCount(0, filterStatus);
    }
}

function renderTasks(tasks, filterStatus) {
    const taskList = document.querySelector('[data-task-list]');
    if (!taskList) return;

    // Remove loading state
    taskList.classList.remove('loading');

    if (tasks.length === 0) {
        // Show appropriate empty state based on filter
        const listContent = taskList.querySelector('[data-list-content]');
        const emptyStates = taskList.querySelectorAll('[data-empty-state]');
        const loadingState = taskList.querySelector('[data-loading-state]');
        
        if (listContent) listContent.style.display = 'none';
        if (loadingState) loadingState.style.display = 'none';
        
        // Hide all empty states first
        emptyStates.forEach(state => state.style.display = 'none');
        
        // Show the appropriate empty state based on filter
        const targetEmptyState = taskList.querySelector(`[data-empty-state][data-filter="${filterStatus}"]`);
        if (targetEmptyState) {
            targetEmptyState.style.display = 'flex';
        }
        return;
    }

    // Sort tasks by RICU score (highest first)
    const sortedTasks = tasks.sort((a, b) => (b.ricu || 0) - (a.ricu || 0));
    
    // Render task items
    const taskItems = sortedTasks.map(task => createTaskHTML(task, filterStatus)).join('');
    const taskItemsContainer = taskList.querySelector('[data-task-items]');
    if (taskItemsContainer) {
        taskItemsContainer.innerHTML = taskItems;
    }
    
    // Show list content and hide other states
    const listContent = taskList.querySelector('[data-list-content]');
    const emptyStates = taskList.querySelectorAll('[data-empty-state]');
    const loadingState = taskList.querySelector('[data-loading-state]');
    
    if (listContent) listContent.style.display = 'block';
    emptyStates.forEach(state => state.style.display = 'none');
    if (loadingState) loadingState.style.display = 'none';
    
    // Add click handlers for task actions
    setupTaskActionHandlers();
    
    // Add drag and drop functionality
    setupTaskDragAndDrop();
    
    // Add click handler for link tools button
    setupLinkToolsHandler();
}

function createTaskHTML(task, filterStatus) {
    const title = task.title || task.task || task.text || task.description || 'Untitled Task';
    const icon = getTaskIcon(task);
    
    // Get RICU score, ensuring it's within bounds (0.51 to 50)
    const ricuScore = Math.min(50, Math.max(0.51, task.ricu || task.priority_score || 1));
    
    // Check if task is completed
    const isCompleted = task.status === 'completed' || filterStatus === 'completed';
    
    return `
        <div class="task-row" data-task-id="${task.id}" data-ricu="${ricuScore}" data-completed="${isCompleted}" data-task-click>
            <div class="task-left">
                <div class="task-icon">${icon}</div>
                <div class="task-title">${escapeHtml(title)}</div>
            </div>
            <div class="task-actions">
                <button class="task-action" data-action="delete" aria-label="Delete">
                    <img src="imgs/tasks_general/trash.svg" alt="Delete" />
                </button>
                <button class="task-action" data-action="grab" aria-label="Grab">
                    <img src="imgs/tasks_general/grab.svg" alt="Grab" />
                </button>
            </div>
        </div>
    `;
}

function getTaskIcon(task) {
    const taskText = (task.task || '').toLowerCase();
    const source = (task.source || '').toLowerCase();
    
    // Use specific icons based on task content and source
    if (taskText.includes('slack') || source.includes('slack')) {
        return '<img src="imgs/sources/slack.svg" alt="Slack" />';
    }
    else if (taskText.includes('gmail') || source.includes('gmail')) {
        return '<img src="imgs/sources/gmail.svg" alt="Gmail" />';
    }
    else if (taskText.includes('calendar') || source.includes('calendar')) {
        return '<img src="imgs/sources/calendar.svg" alt="Calendar" />';
    }
    else {
        return '<img src="imgs/sources/primitiv.svg" alt="Primitiv" />';
    }
}

function setupTaskActionHandlers() {
    const taskItems = document.querySelectorAll('.task-row');
    
    taskItems.forEach(item => {
        const deleteBtn = item.querySelector('[data-action="delete"]');
        const grabBtn = item.querySelector('[data-action="grab"]');
        
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const taskId = item.dataset.taskId;
                await deleteTask(taskId);
            });
        }
        
        // Grab button is only used for drag and drop, no click handler needed
    });
}

async function deleteTask(taskId) {
    try {
        await apiClient.trashTask(taskId);
        console.log('Task deleted:', taskId);
        // Reload tasks to show updated state
        loadTasks();
    } catch (error) {
        console.error('Failed to delete task:', error);
    }
}

// ===== DRAG AND DROP FUNCTIONALITY =====

function setupTaskDragAndDrop() {
    let draggedTask = null;
    let draggedTaskData = null;
    let dropPlaceholder = null;

    // Handle grab button mousedown to initiate drag
    document.addEventListener('mousedown', (event) => {
        const grabBtn = event.target.closest('[data-action="grab"]');
        if (!grabBtn) return;

        event.preventDefault();
        const taskRow = grabBtn.closest('.task-row');
        if (!taskRow) return;

        // Store task data
        draggedTask = taskRow;
        const originalIndex = Array.from(taskRow.parentElement.children).indexOf(taskRow);
        const originalNextSibling = taskRow.nextElementSibling;

        draggedTaskData = {
            id: taskRow.getAttribute('data-task-id'),
            element: taskRow,
            originalIndex: originalIndex,
            originalNextSibling: originalNextSibling,
            grabBtn: grabBtn
        };

        // Add dragging class for visual feedback
        taskRow.classList.add('dragging');
        taskRow.style.opacity = '0.5';

        // Create placeholder element
        dropPlaceholder = document.createElement('div');
        dropPlaceholder.className = 'task-row-placeholder';
        dropPlaceholder.style.height = taskRow.offsetHeight + 'px';
        dropPlaceholder.style.backgroundColor = '#e0e0e0';
        dropPlaceholder.style.border = '2px dashed #999';
        dropPlaceholder.style.marginBottom = '8px';
        dropPlaceholder.style.borderRadius = '8px';

        // Handle mouse move for dragging
        const handleMouseMove = (e) => {
            if (!draggedTask) return;

            const taskList = document.querySelector('[data-task-items]');
            if (!taskList) return;

            const allTasks = Array.from(taskList.querySelectorAll('.task-row:not(.dragging)'));

            // Find the element we're hovering over
            const afterElement = allTasks.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = e.clientY - box.top - box.height / 2;

                if (offset < 0 && offset > closest.offset) {
                    return { offset: offset, element: child };
                } else {
                    return closest;
                }
            }, { offset: Number.NEGATIVE_INFINITY }).element;

            // Determine the new position index
            let newPositionIndex;
            if (afterElement == null) {
                newPositionIndex = allTasks.length;
            } else {
                newPositionIndex = allTasks.indexOf(afterElement);
            }

            // Get current dragged task index (among non-dragging tasks)
            const currentIndex = draggedTaskData.originalIndex;

            // Determine if priority is increasing or decreasing
            let priorityText = '';
            let placeholderBgColor = '#e0e0e0';
            let placeholderBorderColor = '#999';
            let placeholderTextColor = '#666';

            if (newPositionIndex < currentIndex) {
                // Moving up = higher priority
                priorityText = 'Higher Priority';
                placeholderBgColor = '#e3f2fd'; // Light blue background
                placeholderBorderColor = '#64b5f6'; // Light blue border
                placeholderTextColor = '#1976d2'; // Blue text
            } else if (newPositionIndex > currentIndex) {
                // Moving down = lower priority
                priorityText = 'Lower Priority';
                placeholderBgColor = '#ffebee'; // Light red background
                placeholderBorderColor = '#ef5350'; // Light red border
                placeholderTextColor = '#c62828'; // Red text
            } else {
                // Same position
                priorityText = 'Same Priority';
            }

            // Update placeholder styles and content
            dropPlaceholder.style.backgroundColor = placeholderBgColor;
            dropPlaceholder.style.borderColor = placeholderBorderColor;
            dropPlaceholder.innerHTML = `<div style="
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100%;
              font-size: 14px;
              font-weight: 500;
              color: ${placeholderTextColor};
            ">${priorityText}</div>`;

            // Remove existing placeholder if it's already in the DOM
            if (dropPlaceholder.parentElement) {
                dropPlaceholder.remove();
            }

            // Insert placeholder at the appropriate position
            if (afterElement == null) {
                taskList.appendChild(dropPlaceholder);
            } else {
                taskList.insertBefore(dropPlaceholder, afterElement);
            }
        };

        // Handle mouse up to complete drag
        const handleMouseUp = async (e) => {
            if (!draggedTask) return;

            // Clean up event listeners
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            // Get final position
            const taskList = document.querySelector('[data-task-items]');
            const placeholderIndex = Array.from(taskList.children).indexOf(dropPlaceholder);

            // Move the task to the new position
            if (placeholderIndex !== -1) {
                taskList.insertBefore(draggedTask, dropPlaceholder);
            }

            // Remove placeholder
            if (dropPlaceholder && dropPlaceholder.parentElement) {
                dropPlaceholder.remove();
            }

            // Calculate new position
            const newIndex = Array.from(taskList.children).indexOf(draggedTask);

            // Remove dragging styles
            draggedTask.classList.remove('dragging');
            draggedTask.style.opacity = '';

            if (newIndex !== draggedTaskData.originalIndex) {
                // Calculate new RICU based on neighboring tasks
                const taskRows = Array.from(taskList.querySelectorAll('.task-row'));
                let newRicu;

                if (taskRows.length === 1) {
                    // Only task, keep current RICU
                    newRicu = parseFloat(draggedTask.getAttribute('data-ricu')) || 1;
                } else if (newIndex === 0) {
                    // Placed at top - make it slightly higher than the current top
                    const nextTask = taskRows[1];
                    const nextRicu = parseFloat(nextTask.getAttribute('data-ricu')) || 1;
                    newRicu = Math.min(50, nextRicu + 0.5);
                } else if (newIndex === taskRows.length - 1) {
                    // Placed at bottom - make it slightly lower than the current bottom
                    const prevTask = taskRows[newIndex - 1];
                    const prevRicu = parseFloat(prevTask.getAttribute('data-ricu')) || 1;
                    newRicu = Math.max(0.51, prevRicu - 0.5);
                } else {
                    // Placed between two tasks - take the average
                    const prevTask = taskRows[newIndex - 1];
                    const nextTask = taskRows[newIndex + 1];
                    const prevRicu = parseFloat(prevTask.getAttribute('data-ricu')) || 1;
                    const nextRicu = parseFloat(nextTask.getAttribute('data-ricu')) || 1;
                    newRicu = (prevRicu + nextRicu) / 2;
                }

                // Ensure RICU is within bounds
                newRicu = Math.min(50, Math.max(0.51, newRicu));
                newRicu = Math.round(newRicu * 100) / 100; // Round to 2 decimal places

                // Automatically save the new priority
                await updateTaskPriority(draggedTaskData.id, newRicu, draggedTask);
            }

            // Reset drag state
            draggedTask = null;
            draggedTaskData = null;
            dropPlaceholder = null;
        };

        // Attach document-level event listeners
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    });
}

async function updateTaskPriority(taskId, newRicu, taskElement) {
    try {
        if (!apiClient) {
            console.error('API client not available');
            return;
        }

        // Get current task data to preserve reach, confidence, urgency
        const response = await apiClient.getTask(taskId);
        const currentTask = response.data.task;

        // Calculate required impact to achieve target RICU
        const reach = currentTask.reach || 1;
        const confidence = currentTask.confidence || 1;
        const urgency = currentTask.urgency || 1;

        const newImpact = (newRicu * urgency) / (reach * confidence);

        // Update task with new impact and RICU
        await apiClient.updateTask(taskId, {
            impact: Math.max(1, Math.min(10, newImpact)),
            ricu: newRicu
        });

        console.log(`Task reordered: new RICU=${newRicu}, new Impact=${newImpact}`);

        // Update the data-ricu attribute on the task row
        taskElement.setAttribute('data-ricu', newRicu);

        // Show brief success feedback
        taskElement.style.backgroundColor = '#e8f5e8';
        setTimeout(() => {
            taskElement.style.backgroundColor = '';
        }, 500);

    } catch (error) {
        console.error('Failed to update task priority:', error);
        
        // Show error feedback
        taskElement.style.backgroundColor = '#ffeaea';
        setTimeout(() => {
            taskElement.style.backgroundColor = '';
        }, 1000);
    }
}

function updateTaskCount(count, filterStatus) {
    const safeCount = count != null ? count : 0;
    const countElement = document.querySelector(`[data-filter="${filterStatus}"] [data-task-count] .task-count-number`);
    const indicatorElement = document.querySelector(`[data-filter="${filterStatus}"] [data-task-count]`);
    
    if (countElement && countElement.textContent) {
        countElement.textContent = safeCount.toString();
    }
    
    if (indicatorElement) {
        // Show indicator if count > 0, hide if count is 0
        indicatorElement.style.display = safeCount > 0 ? 'flex' : 'none';
    }
}


function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Setup task filter functionality
function setupTaskFilters() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    
    filterButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            // Remove active class from all buttons
            filterButtons.forEach(b => b.classList.remove('active'));
            
            // Add active class to clicked button
            btn.classList.add('active');
            
            // Get filter status
            const filterStatus = btn.dataset.filter;
            
            // Load tasks with new filter
            await loadTasks(filterStatus);
        });
    });
}

// Setup refresh button functionality
function setupRefreshButton() {
    const refreshBtn = document.querySelector('[data-refresh-tasks]');

    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            // Prevent multiple clicks while processing
            if (refreshBtn.disabled) {
                return;
            }
            
            // Disable button to prevent duplicate clicks
            refreshBtn.disabled = true;
            
            try {
                // Add spinning animation to button
                refreshBtn.style.animation = 'spin 1s linear infinite';
                refreshBtn.style.opacity = '0.7';

                // Show syncing indicator
                showSyncingIndicator();

                // Trigger source sync (forced)
                if (apiClient) {
                    await apiClient.forceSync();
                    console.log('Force sync triggered (manual refresh)');
                }

                // Wait for sync to complete
                await waitForSyncCompletion();

                // Reload tasks
                const activeFilter = document.querySelector('.filter-btn.active');
                const filterStatus = activeFilter ? activeFilter.dataset.filter : 'pending';
                await loadTasks(filterStatus);

                // Hide syncing indicator
                hideSyncingIndicator();

                // Reset button state
                refreshBtn.style.animation = '';
                refreshBtn.style.opacity = '1';

            } catch (error) {
                console.error('Refresh failed:', error);
                refreshBtn.style.animation = '';
                refreshBtn.style.opacity = '1';
                hideSyncingIndicator();
            } finally {
                // Re-enable button
                refreshBtn.disabled = false;
            }
        });
    }
}

// Setup search input functionality
function setupSearchInput() {
    const searchInput = document.querySelector('[data-search-input]');
    const clearBtn = document.querySelector('[data-search-clear]');
    
    if (searchInput) {
        let searchTimeout;
        
        // Search input handler with debouncing
        searchInput.addEventListener('input', () => {
            const hasValue = searchInput.value.trim().length > 0;
            const searchRoot = searchInput.closest('[data-search]');
            
            if (searchRoot) {
                if (hasValue) {
                    searchRoot.classList.add('has-value');
                } else {
                    searchRoot.classList.remove('has-value');
                }
            }
            
            // Debounce search filtering (300ms delay)
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                filterTasksBySearch(searchInput.value.trim());
            }, 300);
        });
        
        // Clear button handler (if clear button exists)
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                const searchRoot = searchInput.closest('[data-search]');
                if (searchRoot) {
                    searchRoot.classList.remove('has-value');
                }
                searchInput.focus();
                
                // Clear search filter immediately
                clearTimeout(searchTimeout);
                filterTasksBySearch('');
            });
        }
        
        console.log('Search functionality initialized');
    } else {
        console.warn('Search input not found');
    }
}

// Filter tasks by search term (similar to extension logic)
function filterTasksBySearch(searchTerm) {
    const taskList = document.querySelector('[data-task-list]');
    if (!taskList) return;

    // Get all task rows (using .task-row for desktop app)
    const taskRows = taskList.querySelectorAll('.task-row');
    
    if (!searchTerm || searchTerm.trim() === '') {
        // Show all tasks when search is empty
        taskRows.forEach(row => {
            row.style.display = 'flex';
        });
        
        // Update task count based on current filter
        const activeFilter = document.querySelector('.filter-btn.active');
        const filterStatus = activeFilter ? activeFilter.dataset.filter : 'pending';
        updateTaskCount(taskRows.length, filterStatus);
        
        // Show/hide empty state
        const listContent = taskList.querySelector('[data-list-content]');
        const emptyState = taskList.querySelector('[data-empty-state]');
        if (taskRows.length === 0) {
            if (listContent) listContent.style.display = 'none';
            if (emptyState) emptyState.style.display = 'flex';
        } else {
            if (listContent) listContent.style.display = 'flex';
            if (emptyState) emptyState.style.display = 'none';
        }
        return;
    }

    // Filter tasks based on search term
    const searchLower = searchTerm.toLowerCase();
    let visibleCount = 0;

    taskRows.forEach(row => {
        const taskTitle = row.querySelector('.task-title');
        const taskDescription = row.querySelector('.task-description');
        
        if (taskTitle || taskDescription) {
            const titleText = taskTitle ? taskTitle.textContent.toLowerCase() : '';
            const descText = taskDescription ? taskDescription.textContent.toLowerCase() : '';
            
            // Search in both title and description
            const matches = titleText.includes(searchLower) || descText.includes(searchLower);
            
            if (matches) {
                row.style.display = 'flex';
                visibleCount++;
            } else {
                row.style.display = 'none';
            }
        }
    });

    // Update task count
    const activeFilter = document.querySelector('.filter-btn.active');
    const filterStatus = activeFilter ? activeFilter.dataset.filter : 'pending';
    updateTaskCount(visibleCount, filterStatus);
    
    // Show/hide empty state
    const listContent = taskList.querySelector('[data-list-content]');
    const emptyState = taskList.querySelector('[data-empty-state]');
    if (visibleCount === 0) {
        if (listContent) listContent.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
    } else {
        if (listContent) listContent.style.display = 'flex';
        if (emptyState) emptyState.style.display = 'none';
    }
}

function setupLinkToolsHandler() {
    const linkToolsBtn = document.querySelector('[data-link-tools]');
    if (linkToolsBtn) {
        linkToolsBtn.addEventListener('click', () => {
            // Open Primitiv dashboard in default browser
            const { shell } = require('electron');
            shell.openExternal('https://primitiv.tools/dashboard');
        });
    }
}

// ===== NEW TASK VIEW FUNCTIONALITY =====

function setupNewTaskView() {
    // New task button handler
    const newTaskBtn = document.querySelector('[data-new-task]');
    if (newTaskBtn) {
        newTaskBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            console.log('New task button clicked!');
            
            // Get the authenticated auth state container
            const authenticatedState = document.querySelector('[data-auth-state="authenticated"]');
            if (authenticatedState) {
                // Toggle to show new task view
                authenticatedState.classList.add('show-new-task');
                authenticatedState.classList.remove('show-task-detail');
                console.log('show-new-task class added');
                
                // Focus on the title input
                setTimeout(() => {
                    const titleInput = authenticatedState.querySelector('.new-task-view .task-title-input');
                    if (titleInput) {
                        titleInput.focus();
                        titleInput.select();
                    }
                }, 50);
            }
        });
    }

    // Back button handler for new task view
    const newTaskBackBtn = document.querySelector('.new-task-view .task-icon-container');
    if (newTaskBackBtn) {
        newTaskBackBtn.addEventListener('click', () => {
            const authenticatedState = document.querySelector('[data-auth-state="authenticated"]');
            if (authenticatedState) {
                authenticatedState.classList.remove('show-new-task', 'show-task-detail');
            }
        });
    }

    // Save task button handler
    const saveTaskBtn = document.querySelector('.save-task-button');
    if (saveTaskBtn) {
        saveTaskBtn.addEventListener('click', async () => {
            try {
                const titleInput = document.querySelector('.new-task-view .task-title-input');
                const notesTextarea = document.querySelector('.new-task-view .task-notes');
                const dateInput = document.querySelector('.new-task-view .date-input');
                
                if (!titleInput || !titleInput.value.trim()) {
                    alert('Please enter a task title');
                    return;
                }

                // Set loading state
                saveTaskBtn.disabled = true;
                saveTaskBtn.classList.add('loading');
                const saveText = saveTaskBtn.querySelector('.save-text');
                if (saveText) saveText.textContent = 'Saving...';

                // Prepare task data
                const taskData = {
                    title: titleInput.value.trim(),
                    description: notesTextarea ? notesTextarea.value.trim() : '',
                    due_date: dateInput ? dateInput.value : null,
                    source: 'manual',
                    status: 'pending'
                };

                // Create task via API
                if (apiClient) {
                    const response = await apiClient.createTask(taskData);
                    console.log('Task created successfully:', response);
                    
                    // Clear form
                    titleInput.value = '';
                    if (notesTextarea) notesTextarea.value = '';
                    if (dateInput) dateInput.value = '';
                    
                    // Go back to task list
                    const authenticatedState = document.querySelector('[data-auth-state="authenticated"]');
                    if (authenticatedState) {
                        authenticatedState.classList.remove('show-new-task');
                    }
                    
                    // Reload tasks
                    const activeFilter = document.querySelector('.filter-btn.active');
                    const filterStatus = activeFilter ? activeFilter.dataset.filter : 'pending';
                    await loadTasks(filterStatus);
                }

            } catch (error) {
                console.error('Failed to create task:', error);
                alert('Failed to create task. Please try again.');
            } finally {
                // Reset button state
                saveTaskBtn.disabled = false;
                saveTaskBtn.classList.remove('loading');
                const saveText = saveTaskBtn.querySelector('.save-text');
                if (saveText) saveText.textContent = 'Save Task';
            }
        });
    }

}

// ===== TASK DETAIL VIEW FUNCTIONALITY =====

function setupTaskDetailView() {
    // Add click handlers to task rows for opening detail view
    document.addEventListener('click', async (event) => {
        const taskClickElement = event.target.closest('[data-task-click]');
        if (taskClickElement) {
            // If clicking on action buttons, don't trigger task detail
            if (event.target.closest('.task-action')) {
                return;
            }
            
            const taskId = taskClickElement.getAttribute('data-task-id');

            if (taskId) {
                console.log('Task clicked:', taskId);
                await showTaskDetail(taskId);
            }
        }
    });

    // Back button handler for task detail view
    const taskDetailBackBtn = document.querySelector('.task-detail-view .task-icon-container');
    if (taskDetailBackBtn) {
        taskDetailBackBtn.addEventListener('click', () => {
            const authenticatedState = document.querySelector('[data-auth-state="authenticated"]');
            if (authenticatedState) {
                authenticatedState.classList.remove('show-new-task', 'show-task-detail');
            }
        });
    }

    // Edit task button handler
    const editTaskBtn = document.querySelector('.edit-task-button');
    if (editTaskBtn) {
        editTaskBtn.addEventListener('click', async () => {
            const taskId = document.querySelector('.task-detail-view').dataset.taskId;
            if (!taskId) return;

            try {
                const titleInput = document.querySelector('.task-detail-view .task-title-input');
                const notesTextarea = document.querySelector('.task-detail-view .task-notes');
                const dateInput = document.querySelector('.task-detail-view .date-input');

                if (!titleInput || !titleInput.value.trim()) {
                    alert('Please enter a task title');
                    return;
                }

                // Set loading state
                editTaskBtn.disabled = true;
                editTaskBtn.classList.add('loading');
                const editText = editTaskBtn.querySelector('.edit-text');
                if (editText) editText.textContent = 'Updating...';

                // Prepare task data
                const taskData = {
                    title: titleInput.value.trim(),
                    description: notesTextarea ? notesTextarea.value.trim() : '',
                    due_date: dateInput ? dateInput.value : null
                };

                // Update task via API
                if (apiClient) {
                    await apiClient.updateTask(taskId, taskData);
                    console.log('Task updated successfully');
                    
                    // Go back to task list
                    const authenticatedState = document.querySelector('[data-auth-state="authenticated"]');
                    if (authenticatedState) {
                        authenticatedState.classList.remove('show-task-detail');
                    }
                    
                    // Reload tasks
                    const activeFilter = document.querySelector('.filter-btn.active');
                    const filterStatus = activeFilter ? activeFilter.dataset.filter : 'pending';
                    await loadTasks(filterStatus);
                }

            } catch (error) {
                console.error('Failed to update task:', error);
                alert('Failed to update task. Please try again.');
            } finally {
                // Reset button state
                editTaskBtn.disabled = false;
                editTaskBtn.classList.remove('loading');
                const editText = editTaskBtn.querySelector('.edit-text');
                if (editText) editText.textContent = 'Update Task';
            }
        });
    }

    // Enhance task button handler
    const enhanceTaskBtn = document.querySelector('[data-enhance-task]');
    if (enhanceTaskBtn) {
        enhanceTaskBtn.addEventListener('click', async () => {
            const taskId = document.querySelector('.task-detail-view').dataset.taskId;
            if (!taskId) return;

            try {
                // Set loading state
                enhanceTaskBtn.disabled = true;
                enhanceTaskBtn.classList.add('loading');
                const enhanceText = enhanceTaskBtn.querySelector('.enhance-text');
                if (enhanceText) enhanceText.textContent = 'Enhancing...';

                // Enhance task via API
                if (apiClient) {
                    const response = await apiClient.enhanceTask(taskId);
                    console.log('Task enhanced successfully:', response);

                    // Hide the enhance button after successful enhancement
                    enhanceTaskBtn.style.display = 'none';

                    // Reload the task detail view with enhanced data
                    await showTaskDetail(taskId);
                }

            } catch (error) {
                console.error('Failed to enhance task:', error);
                alert('Failed to enhance task. Please try again.');
            } finally {
                // Reset button state
                enhanceTaskBtn.disabled = false;
                enhanceTaskBtn.classList.remove('loading');
                const enhanceText = enhanceTaskBtn.querySelector('.enhance-text');
                if (enhanceText) enhanceText.textContent = 'Enhance with AI';
            }
        });
    }

    // Complete task button handler
    const completeTaskBtn = document.querySelector('.complete-task-button');
    if (completeTaskBtn) {
        completeTaskBtn.addEventListener('click', async () => {
            const taskId = document.querySelector('.task-detail-view').dataset.taskId;
            if (!taskId) return;

            try {
                // Set loading state
                completeTaskBtn.disabled = true;
                completeTaskBtn.classList.add('loading');
                const completeText = completeTaskBtn.querySelector('.complete-text');
                if (completeText) completeText.textContent = 'Completing...';

                // Complete task via API
                if (apiClient) {
                    await apiClient.completeTask(taskId);
                    console.log('Task completed successfully');

                    // Go back to task list
                    const authenticatedState = document.querySelector('[data-auth-state="authenticated"]');
                    if (authenticatedState) {
                        authenticatedState.classList.remove('show-task-detail');
                    }

                    // Reload tasks
                    const activeFilter = document.querySelector('.filter-btn.active');
                    const filterStatus = activeFilter ? activeFilter.dataset.filter : 'pending';
                    await loadTasks(filterStatus);
                }

            } catch (error) {
                console.error('Failed to complete task:', error);
                alert('Failed to complete task. Please try again.');
            } finally {
                // Reset button state
                completeTaskBtn.disabled = false;
                completeTaskBtn.classList.remove('loading');
                const completeText = completeTaskBtn.querySelector('.complete-text');
                if (completeText) completeText.textContent = 'Mark Complete';
            }
        });
    }

    // Auto-save when date changes
    const dateInput = document.querySelector('.task-detail-view .date-input');
    if (dateInput) {
        dateInput.addEventListener('change', async () => {
            const taskId = document.querySelector('.task-detail-view').dataset.taskId;
            if (!taskId) return;

            try {
                // Prepare task data with only the date change
                const taskData = {
                    due_date: dateInput.value || null
                };

                // Update task via API
                if (apiClient) {
                    await apiClient.updateTask(taskId, taskData);
                    console.log('Task date updated successfully');
                }

            } catch (error) {
                console.error('Failed to update task date:', error);
                // Revert the date input on error
                const originalDate = dateInput.dataset.originalDate;
                if (originalDate) {
                    dateInput.value = originalDate;
                }
            }
        });
    }
}

async function showTaskDetail(taskId) {
    try {
        if (!apiClient) {
            console.error('API client not available');
            return;
        }

        // Show the task detail view immediately with skeleton loading
        const authenticatedState = document.querySelector('[data-auth-state="authenticated"]');
        if (authenticatedState) {
            authenticatedState.classList.add('show-task-detail');
            authenticatedState.classList.remove('show-new-task');
        }

        // Show skeleton loading state
        showTaskDetailSkeleton();

        // Fetch task data
        const response = await apiClient.getTask(taskId);
        const task = response.data.task;
        
        console.log('Task detail data:', task);
        
        // Hide skeleton loading
        hideTaskDetailSkeleton();
        
        // Populate task detail view with real data
        populateTaskDetailView(task);
        
    } catch (error) {
        console.error('Failed to load task detail:', error);
        // Hide skeleton on error
        hideTaskDetailSkeleton();
        alert('Failed to load task details. Please try again.');
    }
}

// Show skeleton loading state for task detail
function showTaskDetailSkeleton() {
    const taskDetailView = document.querySelector('.task-detail-view');
    if (!taskDetailView) return;

    // Hide modal body content
    const modalBody = taskDetailView.querySelector('.modal-body');
    const modalContentArea = taskDetailView.querySelector('.modal-content-area');
    const modalFooter = taskDetailView.querySelector('.modal-footer');
    
    if (modalBody) modalBody.style.display = 'none';
    if (modalContentArea) modalContentArea.style.display = 'none';
    if (modalFooter) modalFooter.style.display = 'none';

    // Create skeleton loading element if it doesn't exist
    let skeletonElement = taskDetailView.querySelector('.task-detail-skeleton');
    if (!skeletonElement) {
        skeletonElement = document.createElement('div');
        skeletonElement.className = 'task-detail-skeleton';
        skeletonElement.innerHTML = `
            <!-- Mock Modal Body -->
            <div class="modal-body" style="padding: 16px;">
                <div style="margin-bottom: 16px;">
                    <div class="skeleton-title"></div>
                </div>
                
                <div class="task-meta-container">
                    <div style="margin-bottom: 12px;">
                        <div class="skeleton-participant"></div>
                    </div>
                    <div class="task-actions">
                        <div class="skeleton-action-button"></div>
                        <div class="skeleton-action-button"></div>
                    </div>
                </div>
            </div>

            <!-- Mock Modal Content Area -->
            <div class="modal-content-area">
                <div class="notes-section" style="padding: 16px;">
                    <div class="skeleton-notes"></div>
                    <div class="skeleton-notes"></div>
                    <div class="skeleton-notes" style="width: 75%;"></div>
                </div>

                <div class="suggested-actions-section" style="padding: 16px;">
                    <div class="section-label" style="font-size: 12px; color: #666; margin-bottom: 12px;">Suggested Actions</div>
                    <div class="suggested-actions-container">
                        <div class="skeleton-action"></div>
                        <div class="skeleton-action"></div>
                        <div class="skeleton-action"></div>
                    </div>
                </div>
            </div>

            <!-- Mock Modal Footer -->
            <div class="modal-footer" style="padding: 16px;">
                <div class="footer-actions">
                    <div class="skeleton-complete-button"></div>
                </div>
            </div>
        `;
        
        taskDetailView.appendChild(skeletonElement);
    }
    
    skeletonElement.style.display = 'block';
}

// Hide skeleton loading state
function hideTaskDetailSkeleton() {
    const taskDetailView = document.querySelector('.task-detail-view');
    if (!taskDetailView) return;

    const skeletonElement = taskDetailView.querySelector('.task-detail-skeleton');
    if (skeletonElement) {
        skeletonElement.style.display = 'none';
    }

    // Show modal content
    const modalBody = taskDetailView.querySelector('.modal-body');
    const modalContentArea = taskDetailView.querySelector('.modal-content-area');
    const modalFooter = taskDetailView.querySelector('.modal-footer');
    
    if (modalBody) modalBody.style.display = 'block';
    if (modalContentArea) modalContentArea.style.display = 'block';
    if (modalFooter) modalFooter.style.display = 'flex';
}

function populateTaskDetailView(task) {
    const taskDetailView = document.querySelector('.task-detail-view');
    if (!taskDetailView) return;

    // Store task ID for later use
    taskDetailView.dataset.taskId = task.id;

    // Show/hide enhance button based on is_enhanced status
    const enhanceBtn = document.querySelector('[data-enhance-task]');
    if (enhanceBtn) {
        if (task.is_enhanced === false) {
            enhanceBtn.style.display = 'flex';
        } else {
            enhanceBtn.style.display = 'none';
        }
    }

    // Populate title
    const titleInput = taskDetailView.querySelector('.task-title-input');
    if (titleInput) {
        titleInput.value = task.title || task.task || task.text || task.description || '';
    }

    // Populate notes
    const notesDiv = taskDetailView.querySelector('.task-detail-notes');
    if (notesDiv) {
        const content = task.description || task.notes || task.context || '';
        notesDiv.textContent = content;
    }

    // Populate due date
    const dateInput = taskDetailView.querySelector('.date-input');
    if (dateInput) {
        if (task.due_date) {
            const dueDate = new Date(task.due_date);
            // Format for datetime-local format (YYYY-MM-DDTHH:mm)
            const localDateTime = new Date(dueDate.getTime() - dueDate.getTimezoneOffset() * 60000);
            dateInput.value = localDateTime.toISOString().slice(0, 16);
        } else {
            dateInput.value = '';
        }
        // Store original date for error handling
        dateInput.dataset.originalDate = dateInput.value;
    }

    // Update source icon
    const sourceIcon = taskDetailView.querySelector('.source-icon');
    if (sourceIcon) {
        const sourceIconPath = getSourceIconPath(task);
        sourceIcon.src = sourceIconPath;
    }

    // Populate participants
    populateParticipants(task, taskDetailView);

    // Populate suggested actions (if any)
    populateSuggestedActions(task, taskDetailView);
}

function populateParticipants(task, container) {
    const participantsContainer = container.querySelector('.participants-container');
    if (!participantsContainer) return;

    // Clear existing participants
    participantsContainer.innerHTML = '';

    if (task.participants && task.participants.length > 0) {
        task.participants.forEach((participant) => {
            const userInfo = createParticipantElement(participant);
            participantsContainer.appendChild(userInfo);
        });
    } else {
        // If no participants, show default "Me"
        const defaultUserInfo = createParticipantElement('Me');
        participantsContainer.appendChild(defaultUserInfo);
    }
}

function createParticipantElement(participant) {
    const userInfo = document.createElement('div');
    userInfo.className = 'user-info';

    let name = 'Me';
    let initials = 'ME';

    if (typeof participant === 'string') {
        // Handle string format "Name <email@domain.com>" or just email
        const emailString = participant.trim();
        const nameEmailMatch = emailString.match(/^(.+?)\s*<(.+?)>$/);
        
        if (nameEmailMatch) {
            // Extract name and email from "Name <email@domain.com>" format
            name = nameEmailMatch[1].trim();
            const email = nameEmailMatch[2].trim();
            
            // Generate initials from the actual name
            const nameParts = name.split(/\s+/);
            if (nameParts.length >= 2) {
                // Take first letter of first and last name
                initials = (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();
            } else if (nameParts.length === 1) {
                // Single name - take first two letters
                initials = name.substring(0, 2).toUpperCase();
            }
        } else if (emailString.includes('@')) {
            // Just email format
            name = emailString.split('@')[0];
            
            // Generate initials from email username
            if (name.includes('.') || name.includes('_')) {
                const parts = name.split(/[._]/);
                initials = parts.map(part => part[0]).join('').substring(0, 2).toUpperCase();
            } else {
                initials = name.substring(0, 2).toUpperCase();
            }
        } else {
            // Just a name
            name = emailString;
            const nameParts = name.split(/\s+/);
            if (nameParts.length >= 2) {
                initials = (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();
            } else {
                initials = name.substring(0, 2).toUpperCase();
            }
        }
    } else if (participant && typeof participant === 'object') {
        // Handle object format { role: 'to', email: 'email@domain.com', name: 'Name' }
        if (participant.name) {
            name = participant.name;
            const nameParts = name.split(/\s+/);
            if (nameParts.length >= 2) {
                initials = (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();
            } else {
                initials = name.substring(0, 2).toUpperCase();
            }
        } else if (participant.email) {
            name = participant.email.split('@')[0];
            if (name.includes('.') || name.includes('_')) {
                const parts = name.split(/[._]/);
                initials = parts.map(part => part[0]).join('').substring(0, 2).toUpperCase();
            } else {
                initials = name.substring(0, 2).toUpperCase();
            }
        }
    }

    userInfo.innerHTML = `
        <div class="user-avatar-small">
            <div class="user-initials-small">${initials}</div>
        </div>
        <div class="user-name-small">${name}</div>
    `;

    return userInfo;
}

function getSourceIconPath(task) {
    const source = (task.source || '').toLowerCase();
    const taskText = (task.task || task.title || '').toLowerCase();
    
    if (source.includes('slack') || taskText.includes('slack')) {
        return 'imgs/sources/slack.svg';
    }
    else if (source.includes('gmail') || taskText.includes('gmail')) {
        return 'imgs/sources/gmail.svg';
    }
    else if (source.includes('calendar') || taskText.includes('calendar')) {
        return 'imgs/sources/calendar.svg';
    }
    else {
        return 'imgs/sources/primitiv.svg';
    }
}

function populateSuggestedActions(task, taskDetailView) {
    const suggestedActionsContainer = taskDetailView.querySelector('[data-suggested-actions-container]');
    const suggestedActionsSection = taskDetailView.querySelector('.suggested-actions-section');

    if (!suggestedActionsContainer) return;

    // Clear existing actions
    suggestedActionsContainer.innerHTML = '';

    // Check if task has AI suggestions
    if (!task.ai_suggestions || !Array.isArray(task.ai_suggestions) || task.ai_suggestions.length === 0) {
        // Hide the entire suggested actions section if no AI suggestions
        if (suggestedActionsSection) {
            suggestedActionsSection.style.display = 'none';
        }
        return;
    }

    // Show the section if it was previously hidden
    if (suggestedActionsSection) {
        suggestedActionsSection.style.display = 'block';
    }

    // Map AI suggestions to proper format
    const suggestions = task.ai_suggestions.map(suggestion => {
        if (typeof suggestion === 'string') {
            return { suggestion: suggestion, rating: null };
        } else if (suggestion && suggestion.suggestion) {
            return { suggestion: suggestion.suggestion, rating: suggestion.rating || null };
        }
        return { suggestion: String(suggestion), rating: null };
    });

    suggestions.forEach((suggestionData, index) => {
        const suggestionText = suggestionData.suggestion;
        const currentRating = suggestionData.rating;
        
        const actionItem = document.createElement('div');
        actionItem.className = 'suggested-action';
        actionItem.innerHTML = `
            <div class="suggested-action-text">${escapeHtml(suggestionText)}</div>
            <div class="suggested-action-buttons">
                <button class="suggested-action-button thumbs-up ${currentRating === 'good' ? 'rated' : ''}" data-suggestion-index="${index}" data-rating-type="up">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12.5 4.89999L11.6667 8.33332H16.525C16.7838 8.33332 17.0389 8.39356 17.2704 8.50928C17.5018 8.62499 17.7031 8.793 17.8584 8.99999C18.0136 9.20698 18.1185 9.44728 18.1648 9.70185C18.2111 9.95642 18.1975 10.2183 18.125 10.4667L16.1834 17.1333C16.0824 17.4795 15.8718 17.7836 15.5834 18C15.2949 18.2164 14.944 18.3333 14.5834 18.3333H3.33335C2.89133 18.3333 2.4674 18.1577 2.15484 17.8452C1.84228 17.5326 1.66669 17.1087 1.66669 16.6667V9.99999C1.66669 9.55796 1.84228 9.13404 2.15484 8.82148C2.4674 8.50892 2.89133 8.33332 3.33335 8.33332H5.63335C5.94342 8.33316 6.2473 8.2465 6.51082 8.08309C6.77433 7.91968 6.98704 7.686 7.12502 7.40832L10 1.66666C10.393 1.67152 10.7798 1.76513 11.1315 1.94049C11.4832 2.11584 11.7908 2.36841 12.0312 2.67933C12.2716 2.99024 12.4386 3.35146 12.5198 3.73599C12.601 4.12053 12.5942 4.51844 12.5 4.89999Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M5.83337 8.33337V18.3334" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <button class="suggested-action-button thumbs-down ${currentRating === 'bad' ? 'rated' : ''}" data-suggestion-index="${index}" data-rating-type="down">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M14.1667 11.6667V1.66666" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M7.50002 15.1L8.33335 11.6667H3.47502C3.21627 11.6667 2.96109 11.6064 2.72966 11.4907C2.49823 11.375 2.29693 11.207 2.14168 11C1.98644 10.793 1.88152 10.5527 1.83523 10.2981C1.78895 10.0436 1.80257 9.78171 1.87502 9.53332L3.81668 2.86666C3.91766 2.52046 4.12819 2.21636 4.41668 1.99999C4.70518 1.78362 5.05607 1.66666 5.41668 1.66666H16.6667C17.1087 1.66666 17.5326 1.84225 17.8452 2.15481C18.1578 2.46737 18.3333 2.8913 18.3333 3.33332V9.99999C18.3333 10.442 18.1578 10.8659 17.8452 11.1785C17.5326 11.4911 17.1087 11.6667 16.6667 11.6667H14.3667C14.0566 11.6668 13.7527 11.7535 13.4892 11.9169C13.2257 12.0803 13.013 12.314 12.875 12.5917L10 18.3333C9.60704 18.3285 9.22023 18.2348 8.86851 18.0595C8.51679 17.8841 8.20924 17.6316 7.96885 17.3207C7.72845 17.0097 7.56142 16.6485 7.48024 16.264C7.39905 15.8795 7.40581 15.4815 7.50002 15.1Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            </div>
        `;
        
        // Add click handlers for thumbs up/down buttons
        const thumbsUpBtn = actionItem.querySelector('.thumbs-up');
        const thumbsDownBtn = actionItem.querySelector('.thumbs-down');
        
        thumbsUpBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await handleSuggestionRating(task.id, index, 'up', thumbsUpBtn, thumbsDownBtn);
        });
        
        thumbsDownBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await handleSuggestionRating(task.id, index, 'down', thumbsUpBtn, thumbsDownBtn);
        });
        
        suggestedActionsContainer.appendChild(actionItem);
    });
}

async function handleSuggestionRating(taskId, suggestionIndex, ratingType, thumbsUpBtn, thumbsDownBtn) {
    try {
        const isCurrentlyRated = ratingType === 'up' ? thumbsUpBtn.classList.contains('rated') : thumbsDownBtn.classList.contains('rated');
        
        // Update UI first
        thumbsUpBtn.classList.remove('rated');
        thumbsDownBtn.classList.remove('rated');
        
        if (isCurrentlyRated) {
            // If currently rated, unrate it (don't call API)
            console.log(`Unrated suggestion ${suggestionIndex}`);
        } else {
            // If not rated, rate it
            const newRating = ratingType === 'up' ? 'good' : 'bad';
            
            // Call API to update rating
            await apiClient.rateTaskSuggestion(taskId, suggestionIndex, newRating);
            
            // Apply new rating to UI
            if (newRating === 'good') {
                thumbsUpBtn.classList.add('rated');
            } else if (newRating === 'bad') {
                thumbsDownBtn.classList.add('rated');
            }
            
            console.log(`Rated suggestion ${suggestionIndex} as ${newRating === 'good' ? 'thumbs up' : 'thumbs down'}`);
        }
    } catch (error) {
        console.error('Failed to rate suggestion:', error);
        // Revert UI changes on error
        thumbsUpBtn.classList.remove('rated');
        thumbsDownBtn.classList.remove('rated');
    }
}

function generateSuggestedActions(task) {
    const suggestions = [];
    const taskText = (task.task || task.title || '').toLowerCase();
    
    // Basic suggestions based on common task patterns
    if (taskText.includes('email') || taskText.includes('message')) {
        suggestions.push('Reply to this email');
        suggestions.push('Forward to team member');
    }
    
    if (taskText.includes('meeting') || taskText.includes('call')) {
        suggestions.push('Schedule follow-up meeting');
        suggestions.push('Send meeting notes');
    }
    
    if (taskText.includes('review') || taskText.includes('check')) {
        suggestions.push('Mark as reviewed');
        suggestions.push('Request additional information');
    }
    
    // Default suggestions
    if (suggestions.length === 0) {
        suggestions.push('Add reminder for tomorrow');
        suggestions.push('Share with team');
        suggestions.push('Break into smaller tasks');
    }
    
    return suggestions.slice(0, 3); // Limit to 3 suggestions
}

// ===== SETTINGS FUNCTIONALITY =====

let isSleeping = false;

function setupSettings() {
    const settingsOverlay = document.querySelector('[data-settings-overlay]');

    // Show/hide settings based on auth state
    updateSettingsUIForAuthState();

    // Setup click handlers
    setupSettingsClickHandlers();

    // Setup sleep modal
    setupSleepModal();
}

function showSettings() {
    const settingsOverlay = document.querySelector('[data-settings-overlay]');
    const taskManagement = document.querySelector('.task-management');
    const newTaskView = document.querySelector('[data-new-task-view]');
    const taskDetailView = document.querySelector('[data-task-detail-view]');
    const authStates = document.querySelectorAll('[data-auth-state]');

    if (settingsOverlay) {
        // Hide all auth states
        authStates.forEach(state => state.classList.remove('active'));

        // Hide task views
        if (taskManagement) taskManagement.classList.remove('active');
        if (newTaskView) newTaskView.classList.remove('active');
        if (taskDetailView) taskDetailView.classList.remove('active');

        // Show settings
        settingsOverlay.style.display = 'flex';
        updateSettingsUIForAuthState();
    }
}

function hideSettings() {
    const settingsOverlay = document.querySelector('[data-settings-overlay]');
    const taskManagement = document.querySelector('.task-management');

    if (settingsOverlay) {
        settingsOverlay.style.display = 'none';

        // Restore the active auth state
        if (authService) {
            const currentAuthState = authService.getAuthState();
            const authStateElement = document.querySelector(`[data-auth-state="${currentAuthState}"]`);
            if (authStateElement) {
                authStateElement.classList.add('active');
            }
        }

        // Show task management view if authenticated
        if (taskManagement && authService && authService.getAuthState() === 'authenticated') {
            taskManagement.classList.add('active');
        }
    }
}

function toggleSettings() {
    const settingsOverlay = document.querySelector('[data-settings-overlay]');

    if (settingsOverlay && settingsOverlay.style.display === 'flex') {
        hideSettings();
    } else {
        showSettings();
    }
}

function updateSettingsUIForAuthState() {
    const integrationsOption = document.querySelector('[data-integrations]');
    const logoutOption = document.querySelector('[data-logout]');
    const loginOption = document.querySelector('[data-login]');

    const isAuth = authService && authService.getAuthState() === 'authenticated';

    if (isAuth) {
        if (integrationsOption) integrationsOption.style.display = 'flex';
        if (logoutOption) logoutOption.style.display = 'flex';
        if (loginOption) loginOption.style.display = 'none';
    } else {
        if (integrationsOption) integrationsOption.style.display = 'none';
        if (logoutOption) logoutOption.style.display = 'none';
        if (loginOption) loginOption.style.display = 'flex';
    }
}

function setupSettingsClickHandlers() {
    const integrationsOption = document.querySelector('[data-integrations]');
    const exitOption = document.querySelector('[data-exit]');
    const logoutOption = document.querySelector('[data-logout]');
    const loginOption = document.querySelector('[data-login]');
    const sleepToggle = document.querySelector('[data-sleep-toggle]');
    const settingsOverlay = document.querySelector('[data-settings-overlay]');

    if (integrationsOption) {
        integrationsOption.addEventListener('click', () => {
            console.log('Manage integrations clicked');
            const { shell } = require('electron');
            shell.openExternal('https://primitiv.tools/dashboard');
            hideSettings();
        });
    }

    if (exitOption) {
        exitOption.addEventListener('click', () => {
            console.log('Exit clicked');
            ipcRenderer.send('exit-app');
        });
    }

    if (logoutOption) {
        logoutOption.addEventListener('click', async () => {
            console.log('Logout clicked');

            try {
                if (authService) {
                    await authService.logout();
                    hideSettings();
                }
            } catch (error) {
                console.error('Logout failed:', error);
                alert('Failed to log out. Please try again.');
            }
        });
    }

    if (loginOption) {
        loginOption.addEventListener('click', () => {
            console.log('Login clicked');
            hideSettings();
            if (authService) {
                authService.login();
            }
        });
    }

    if (sleepToggle) {
        sleepToggle.addEventListener('click', () => {
            console.log('Sleep toggle clicked');

            if (isSleeping) {
                console.log('Waking up from sleep');
                ipcRenderer.send('wake-up');
                hideSettings();
            } else {
                showSleepModal();
            }
        });
    }

    // Close settings when clicking on overlay background
    if (settingsOverlay) {
        settingsOverlay.addEventListener('click', (e) => {
            if (e.target === settingsOverlay) {
                hideSettings();
            }
        });
    }

    // Close settings when clicking outside settings container
    document.addEventListener('click', (e) => {
        const settingsContainer = document.querySelector('.settings-container');
        if (settingsOverlay && settingsOverlay.style.display === 'flex') {
            if (!e.target.closest('.settings-container') && !e.target.closest('[data-sleep-toggle]')) {
                hideSettings();
            }
        }
    });
}

// Sleep modal functionality
function showSleepModal() {
    const modal = document.getElementById('sleepModal');
    if (modal) {
        modal.style.display = 'flex';
        document.getElementById('sleepHours')?.focus();
    }
}

function hideSleepModal() {
    const modal = document.getElementById('sleepModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function setupSleepModal() {
    const modal = document.getElementById('sleepModal');
    const cancelBtn = document.getElementById('sleepCancel');
    const startBtn = document.getElementById('sleepStart');
    const hoursInput = document.getElementById('sleepHours');
    const minutesInput = document.getElementById('sleepMinutes');

    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideSleepModal);
    }

    if (startBtn) {
        startBtn.addEventListener('click', startSleepMode);
    }

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideSleepModal();
            }
        });
    }

    if (hoursInput) {
        hoursInput.addEventListener('input', validateSleepTime);
    }

    if (minutesInput) {
        minutesInput.addEventListener('input', validateSleepTime);
    }

    document.addEventListener('keydown', (e) => {
        if (modal && modal.style.display === 'flex') {
            if (e.key === 'Escape') {
                hideSleepModal();
            } else if (e.key === 'Enter') {
                startSleepMode();
            }
        }
    });
}

function validateSleepTime() {
    const hoursInput = document.getElementById('sleepHours');
    const minutesInput = document.getElementById('sleepMinutes');
    const startBtn = document.getElementById('sleepStart');

    if (!hoursInput || !minutesInput || !startBtn) return;

    const hours = parseInt(hoursInput.value) || 0;
    const minutes = parseInt(minutesInput.value) || 0;

    const isValid = hours > 0 || minutes > 0;
    startBtn.disabled = !isValid;
    startBtn.style.opacity = isValid ? '1' : '0.5';
    startBtn.style.cursor = isValid ? 'pointer' : 'not-allowed';
}

function startSleepMode() {
    const hoursInput = document.getElementById('sleepHours');
    const minutesInput = document.getElementById('sleepMinutes');

    if (!hoursInput || !minutesInput) return;

    const hours = parseInt(hoursInput.value) || 0;
    const minutes = parseInt(minutesInput.value) || 0;

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        console.warn('Invalid time input:', hours, minutes);
        return;
    }

    if (hours === 0 && minutes === 0) {
        console.warn('Cannot sleep for 0 time');
        return;
    }

    console.log(`Starting sleep mode for ${hours}:${minutes.toString().padStart(2, '0')}`);

    isSleeping = true;

    const sleepToggle = document.querySelector('[data-sleep-toggle]');
    const toggleText = sleepToggle?.querySelector('.toggle-text');
    if (toggleText) {
        toggleText.textContent = 'Wake up';
    }

    ipcRenderer.send('start-sleep-mode', hours, minutes);
    hideSleepModal();
    hideSettings();
}

// Listen for sleep timer updates
ipcRenderer.on('update-sleep-timer', (event, hours, minutes) => {
    const sleepToggle = document.querySelector('[data-sleep-toggle]');
    const toggleText = sleepToggle?.querySelector('.toggle-text');

    if (toggleText) {
        toggleText.textContent = 'Wake up';
    }
});

// Listen for sleep mode end
ipcRenderer.on('sleep-mode-ended', (event) => {
    const sleepToggle = document.querySelector('[data-sleep-toggle]');
    const toggleText = sleepToggle?.querySelector('.toggle-text');

    isSleeping = false;

    if (toggleText) {
        toggleText.textContent = '00:00';
    }
});

// Expose settings functions globally for widget.js to call
window.showSettings = showSettings;
window.toggleSettings = toggleSettings;

// Listen for IPC to show main window with specific view
ipcRenderer.on('show-main-window-with-view', (event, view) => {
    console.log('Showing main window with view:', view);
    if (view === 'settings') {
        showSettings();
    } else {
        hideSettings(); // Show tasks by default
    }
});

// Listen for IPC to switch view in main window
ipcRenderer.on('switch-main-window-view', (event, view) => {
    console.log('Switching main window to view:', view);
    if (view === 'settings') {
        showSettings();
    } else {
        hideSettings(); // Show tasks
    }
});
