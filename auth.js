/**
 * Authentication Service for Primitiv Desktop Widget
 * Handles user authentication state, token management, and backend communication
 */

class DesktopAuthService {
    constructor() {
        this.baseUrl = 'https://primitiv.tools';
        this.storageKeys = {
            ACCESS_TOKEN: 'primitivDesktopAccessToken',
            REFRESH_TOKEN: 'primitivDesktopRefreshToken',
            USER_DATA: 'primitivDesktopUserData',
            AUTH_STATE: 'primitivDesktopAuthState'
        };

        this.user = null;
        this.authState = 'unauthenticated';
        this.listeners = [];
    }

    /**
     * Initialize the auth service and load existing authentication state
     */
    async init() {
        try {
            // Load from localStorage (desktop app uses localStorage instead of browser.storage)
            const accessToken = localStorage.getItem(this.storageKeys.ACCESS_TOKEN);
            const refreshToken = localStorage.getItem(this.storageKeys.REFRESH_TOKEN);
            const userData = localStorage.getItem(this.storageKeys.USER_DATA);
            const authState = localStorage.getItem(this.storageKeys.AUTH_STATE);

            this.authState = authState || 'unauthenticated';
            this.user = userData ? JSON.parse(userData) : null;

            // Check if we have both token and user data
            if (accessToken && this.user) {
                // Verify token is still valid
                const isValid = await this.verifyToken(accessToken);
                if (isValid) {
                    this.authState = 'authenticated';
                } else {
                    // Token verification failed, try to refresh
                    if (refreshToken) {
                        const refreshed = await this.refreshAccessToken();
                        if (!refreshed) {
                            // Refresh failed, clear auth data
                            this.clearAuthData(true);
                        }
                    } else {
                        // No refresh token, clear auth data
                        this.clearAuthData(true);
                    }
                }
            } else if (accessToken && !this.user) {
                // We have a token but no user data, clear everything
                this.clearAuthData(true);
            } else if (!accessToken && this.authState === 'authenticated') {
                // No token but stored state says authenticated, clear auth data
                this.clearAuthData(true);
            }

            // Notify listeners of the final auth state
            this.notifyListeners();

            console.log('Desktop Auth Service initialized:', {
                authState: this.authState,
                hasUser: !!this.user,
                hasToken: !!accessToken
            });

            return this.authState;
        } catch (error) {
            console.error('Error initializing auth service:', error);
            this.authState = 'unauthenticated';
            this.notifyListeners();
            return this.authState;
        }
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return this.authState === 'authenticated' && this.user !== null;
    }

    /**
     * Get current user data
     */
    getUser() {
        return this.user;
    }

    /**
     * Get current authentication state
     */
    getAuthState() {
        return this.authState;
    }

    /**
     * Get access token
     */
    async getAccessToken() {
        const token = localStorage.getItem(this.storageKeys.ACCESS_TOKEN);
        if (!token) return null;

        // Check if token is expired
        const isValid = await this.verifyToken(token);
        if (!isValid) {
            // Try to refresh
            const refreshed = await this.refreshAccessToken();
            if (refreshed) {
                return localStorage.getItem(this.storageKeys.ACCESS_TOKEN);
            }
            return null;
        }

        return token;
    }

    /**
     * Verify if token is valid
     */
    async verifyToken(token, forceVerify = false) {
        if (!token) return false;

        try {
            // For desktop app, we'll use the auth status endpoint to verify token
            const response = await fetch(`${this.baseUrl}/api/auth/status?source=desktop`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                return data.status === 'success' && data.user;
            } else {
                // Any non-200 response means token is invalid
                console.log('Token verification failed with status:', response.status);
                return false;
            }
        } catch (error) {
            console.error('Token verification error:', error);
            // If we can't verify due to network issues, return false to force re-authentication
            return false;
        }
    }

    /**
     * Update user data
     */
    async updateUserData(userData) {
        this.user = userData;
        localStorage.setItem(this.storageKeys.USER_DATA, JSON.stringify(userData));
        this.notifyListeners();
    }

    /**
     * Store authentication tokens
     */
    async storeTokens(accessToken, refreshToken) {
        localStorage.setItem(this.storageKeys.ACCESS_TOKEN, accessToken);
        if (refreshToken) {
            localStorage.setItem(this.storageKeys.REFRESH_TOKEN, refreshToken);
        }
    }

    /**
     * Clear all authentication data
     */
    async clearAuthData(skipNotification = false) {
        console.log('🔄 clearAuthData called - clearing authentication data');
        this.user = null;
        this.authState = 'unauthenticated';
        
        localStorage.removeItem(this.storageKeys.ACCESS_TOKEN);
        localStorage.removeItem(this.storageKeys.REFRESH_TOKEN);
        localStorage.removeItem(this.storageKeys.USER_DATA);
        localStorage.removeItem(this.storageKeys.AUTH_STATE);
        
        console.log('🔄 Auth state set to unauthenticated, notifying listeners:', !skipNotification);
        
        if (!skipNotification) {
            this.notifyListeners();
        }
        
        console.log('🔄 clearAuthData completed - current auth state:', this.authState);
    }


    /**
     * Start login process
     */
    async login() {
        try {
            this.authState = 'authenticating';
            this.notifyListeners();

            // Build login URL
            const loginUrl = `${this.baseUrl}/login?source=desktop`;

            // Store the login URL for manual opening if needed
            this.currentLoginUrl = loginUrl;

            // Try to open in browser if electron is available
            if (typeof require !== 'undefined') {
                try {
                    const { shell } = require('electron');
                    await shell.openExternal(loginUrl);
                } catch (e) {
                    console.log('Could not auto-open browser:', e);
                }
            }

            // Start monitoring for auth completion
            this.startAuthMonitoring();

            return true;
        } catch (error) {
            console.error('Login error:', error);
            this.authState = 'unauthenticated';
            this.notifyListeners();
            return false;
        }
    }

    /**
     * Get the current login URL (for manual opening)
     */
    getLoginUrl() {
        return this.currentLoginUrl || `${this.baseUrl}/login?source=desktop`;
    }

    /**
     * Open login URL manually
     */
    async openLoginUrl() {
        const loginUrl = this.getLoginUrl();
        if (typeof require !== 'undefined') {
            try {
                const { shell } = require('electron');
                await shell.openExternal(loginUrl);
                return true;
            } catch (e) {
                console.log('Could not open browser:', e);
            }
        }
        // Fallback to window.open
        window.open(loginUrl, '_blank');
        return true;
    }

    /**
     * Start monitoring for authentication completion
     * With deep link protocol, this is mainly a fallback timeout
     */
    startAuthMonitoring() {
        // Clear any existing monitoring
        if (this.authInterval) {
            clearInterval(this.authInterval);
        }

        console.log('Started authentication monitoring (deep link expected)');
        
        // Set a timeout to stop monitoring after 5 minutes
        this.authTimeout = setTimeout(() => {
            if (this.authState === 'authenticating') {
                console.log('Authentication monitoring timeout - no deep link received');
                this.authState = 'unauthenticated';
                this.notifyListeners();
            }
            
            if (this.authInterval) {
                clearInterval(this.authInterval);
                this.authInterval = null;
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    /**
     * Stop authentication monitoring
     */
    stopAuthMonitoring() {
        if (this.authInterval) {
            clearInterval(this.authInterval);
            this.authInterval = null;
        }
        
        if (this.authTimeout) {
            clearTimeout(this.authTimeout);
            this.authTimeout = null;
        }
        
        console.log('Stopped authentication monitoring');
    }

    /**
     * Fetch user data from API
     */
    async fetchUserData() {
        try {
            const token = await this.getAccessToken();
            if (!token) return false;

            const response = await fetch(`${this.baseUrl}/api/auth/status?source=desktop`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.status === 'success' && data.user) {
                    await this.updateUserData(data.user);
                    this.authState = 'authenticated';
                    this.notifyListeners();
                    
                    this.stopAuthMonitoring();
                    
                    return true;
                } else {
                    console.error('Invalid user data response:', data);
                    return false;
                }
            } else {
                console.error('Failed to fetch user data:', response.status);
                return false;
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
            return false;
        }
    }

    /**
     * Refresh access token
     */
    async refreshAccessToken(retryCount = 0) {
        try {
            const refreshToken = localStorage.getItem(this.storageKeys.REFRESH_TOKEN);
            if (!refreshToken) {
                await this.clearAuthData();
                return false;
            }

            const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    refreshToken: refreshToken
                })
            });

            if (response.ok) {
                const data = await response.json();
                await this.storeTokens(data.tokens?.access_token, data.tokens?.refresh_token);
                return true;
            } else {
                console.error('Token refresh failed:', response.status);
                await this.clearAuthData();
                return false;
            }
        } catch (error) {
            console.error('Token refresh error:', error);
            if (retryCount < 2) {
                // Retry up to 2 times
                return await this.refreshAccessToken(retryCount + 1);
            }
            await this.clearAuthData();
            return false;
        }
    }

    /**
     * Handle authentication completion (called from main process)
     */
    async handleAuthCompletion(tokens, userData) {
        try {
            await this.storeTokens(tokens.accessToken, tokens.refreshToken);
            await this.updateUserData(userData);
            this.authState = 'authenticated';
            this.notifyListeners();
            
            this.stopAuthMonitoring();
            
            return true;
        } catch (error) {
            console.error('Auth completion error:', error);
            this.authState = 'unauthenticated';
            this.notifyListeners();
            return false;
        }
    }

    /**
     * Handle deep link authentication completion
     */
    async handleDeepLinkAuth(authData) {
        try {
            console.log('Handling deep link authentication:', authData);
            
            // Handle direct token data
            if (authData.accessToken && authData.refreshToken) {
                await this.storeTokens(authData.accessToken, authData.refreshToken);
                
                if (authData.userData) {
                    await this.updateUserData(authData.userData);
                } else {
                    await this.fetchUserData();
                }
                
                this.authState = 'authenticated';
                this.notifyListeners();
                this.stopAuthMonitoring();
                
                console.log('Token-based authentication completed successfully');
                return true;
            }
            
            throw new Error('No valid authentication data received');
        } catch (error) {
            console.error('Deep link auth completion error:', error);
            this.authState = 'unauthenticated';
            this.notifyListeners();
            return false;
        }
    }


    /**
     * Handle deep link authentication error
     */
    handleDeepLinkError(error) {
        console.error('Deep link authentication error:', error);
        this.authState = 'unauthenticated';
        this.notifyListeners();
    }

    /**
     * Logout user
     */
    async logout() {
        try {
            const token = await this.getAccessToken();
            if (token) {
                // Call logout endpoint
                await fetch(`${this.baseUrl}/api/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
            }
        } catch (error) {
            console.error('Logout API error:', error);
        } finally {
            await this.clearAuthData();
            
            // Notify main process to update widget auth state
            if (typeof require !== 'undefined') {
                try {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.send('update-auth-state-after-logout');
                } catch (e) {
                    console.log('Could not send logout notification:', e);
                }
            }
        }
    }

    /**
     * Add listener for auth state changes
     */
    addListener(callback) {
        this.listeners.push(callback);
    }

    /**
     * Remove listener
     */
    removeListener(callback) {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * Notify all listeners of auth state change
     */
    notifyListeners() {
        console.log('🔔 Notifying auth listeners - Auth state:', this.authState, 'User:', this.user ? 'Present' : 'None', 'Listeners:', this.listeners.length);
        
        // Persist auth state to localStorage
        localStorage.setItem(this.storageKeys.AUTH_STATE, this.authState);
        
        this.listeners.forEach((callback, index) => {
            try {
                console.log(`🔔 Calling listener ${index + 1}/${this.listeners.length}`);
                callback(this.authState, this.user);
            } catch (error) {
                console.error('Auth listener error:', error);
            }
        });
        
        console.log('🔔 All listeners notified');
    }

    /**
     * Simulate authentication for demo purposes
     */
    async simulateAuthentication() {
        this.authState = 'authenticating';
        this.notifyListeners();
        
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const mockUser = {
            name: 'David V.',
            email: 'david@example.com',
            id: 'demo-user-123'
        };
        
        const mockTokens = {
            accessToken: 'mock-access-token-' + Date.now(),
            refreshToken: 'mock-refresh-token-' + Date.now()
        };
        
        await this.storeTokens(mockTokens.accessToken, mockTokens.refreshToken);
        await this.updateUserData(mockUser);
        this.authState = 'authenticated';
        this.notifyListeners();
        
        return true;
    }
}

// Create global instance
window.desktopAuthService = new DesktopAuthService();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DesktopAuthService;
}
