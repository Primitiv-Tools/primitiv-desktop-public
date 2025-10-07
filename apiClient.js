/**
 * API Client for Desktop App
 * Similar to extension's api.js but adapted for desktop environment
 */

class DesktopApiClient {
    constructor(authService) {
        this.authService = authService;
        this.baseUrl = 'https://primitiv.tools';
    }

    async makeRequest(endpoint, options = {}) {
        try {
            const accessToken = await this.authService.getAccessToken();
            
            if (!accessToken) {
                throw new Error('No valid access token available');
            }

            const url = `${this.baseUrl}${endpoint}`;
            const defaultOptions = {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                },
                credentials: 'include',
            };

            const requestOptions = {
                ...defaultOptions,
                ...options,
                headers: {
                    ...defaultOptions.headers,
                    ...options.headers,
                },
            };

            console.log(`Making API request to: ${url}`);
            const response = await fetch(url, requestOptions);
            
            return await this.handleResponse(response);
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    async handleResponse(response) {
        try {
            // Handle non-JSON responses (like 429 "Too many requests")
            if (response.status === 429) {
                const text = await response.text();
                throw new Error(`Rate limited: ${text || 'Too many requests'}`);
            }

            // Try to parse JSON, but handle cases where response might not be JSON
            let data;
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                const text = await response.text();
                throw new Error(`Expected JSON response, got: ${text.substring(0, 100)}`);
            }
            
            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
            }
            
            return {
                status: 'success',
                data: data.data || data,
                message: data.message
            };
        } catch (error) {
            console.error('Response handling failed:', error);
            throw error;
        }
    }

    // Task-related methods
    async getTasks(filters = {}) {
        const params = new URLSearchParams();
        
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.status) params.append('status', filters.status);
        if (filters.priority) params.append('priority', filters.priority);
        
        const queryString = params.toString();
        const endpoint = `/api/tasks${queryString ? `?${queryString}` : ''}`;
        
        return await this.makeRequest(endpoint);
    }

    async getTask(taskId) {
        return await this.makeRequest(`/api/tasks/${taskId}`);
    }

    async createTask(taskData) {
        // Use the AI-powered manual task creation endpoint
        return await this.createManualTask(taskData);
    }

    async createManualTask(taskData) {
        // Get user info for default participant
        
        // Map desktop task data format to AI endpoint format
        const aiTaskData = {
            task: taskData.title || '',
            context_string: taskData.description || '',
            participants: taskData.participants || [`Me`],
            due_date: taskData.due_date || null,
            reach: null, // Let AI calculate these
            impact: null,
            confidence: null
        };
        
        return await this.makeRequest('/api/ai/tasks/create-manual', {
            method: 'POST',
            body: JSON.stringify(aiTaskData),
        });
    }

    async updateTask(taskId, updates) {
        return await this.makeRequest(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            body: JSON.stringify(updates),
        });
    }

    async completeTask(taskId) {
        return await this.makeRequest(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'completed' }),
        });
    }

    async trashTask(taskId) {
        return await this.makeRequest(`/api/tasks/${taskId}/trash`, {
            method: 'POST',
        });
    }

    async deleteTask(taskId) {
        return await this.makeRequest(`/api/tasks/${taskId}`, {
            method: 'DELETE',
        });
    }

    async rateTaskSuggestion(taskId, suggestionIndex, rating) {
        return await this.makeRequest(`/api/ai/tasks/${taskId}/suggestions/feedback`, {
            method: 'POST',
            body: JSON.stringify({ suggestionIndex, rating }),
        });
    }

    async enhanceTask(taskId) {
        return await this.makeRequest(`/api/ai/tasks/${taskId}/enhance`, {
            method: 'POST',
        });
    }

    // Source sync methods
    async triggerAllSourcesSync(force = false) {
        console.log(`[API] Triggering one-time sync for all user sources${force ? ' (forced)' : ''}`);
        return await this.makeRequest('/api/queues/source-ingestion/trigger-all', {
            method: 'POST',
            body: JSON.stringify({
                force: force
            })
        });
    }

    async triggerRICURecalculation(force = false) {
        console.log(`[API] Triggering one-time RICU recalculation${force ? ' (forced)' : ''}`);
        return await this.makeRequest('/api/queues/ricu-recalculation/trigger', {
            method: 'POST',
            body: JSON.stringify({ force: force })
        });
    }

    async forceSync() {
        console.log('[API] Forcing sync for all user sources and RICU recalculation');

        // Trigger both sync and RICU recalculation in parallel
        const [syncResult, ricuResult] = await Promise.allSettled([
            this.triggerAllSourcesSync(true),
            this.triggerRICURecalculation(true)
        ]);

        return {
            sync: syncResult.status === 'fulfilled' ? syncResult.value : { error: syncResult.reason },
            ricu: ricuResult.status === 'fulfilled' ? ricuResult.value : { error: ricuResult.reason }
        };
    }

    // User profile methods
    async getUserProfile() {
        return await this.makeRequest('/api/users/profile');
    }

    async getUserSources() {
        return await this.makeRequest('/api/users/sources');
    }

    // Health check
    async healthCheck() {
        try {
            return await this.makeRequest('/api/health');
        } catch (error) {
            return { status: 'error', message: error.message };
        }
    }
}

// Export for use in mainWindow.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DesktopApiClient;
} else {
    window.DesktopApiClient = DesktopApiClient;
}
