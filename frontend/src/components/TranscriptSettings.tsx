import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import { ModelManager } from './WhisperModelManager';
import { ParakeetModelManager } from './ParakeetModelManager';

// UPDATE: Add 'qwen3' to the provider types
export interface TranscriptModelProps {
    provider: 'localWhisper' | 'parakeet' | 'deepgram' | 'elevenLabs' | 'groq' | 'openai' | 'qwen3';
    model: string;
    apiKey?: string | null;
}

export interface TranscriptSettingsProps {
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onModelSelect?: () => void;
}

export function TranscriptSettings({ transcriptModelConfig, setTranscriptModelConfig, onModelSelect }: TranscriptSettingsProps) {
    const [apiKey, setApiKey] = useState<string | null>(transcriptModelConfig.apiKey || null);
    const [showApiKey, setShowApiKey] = useState<boolean>(false);
    const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(true);
    const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
    const [uiProvider, setUiProvider] = useState<TranscriptModelProps['provider']>(transcriptModelConfig.provider);
    // UPDATE: Add state for Qwen3 endpoint
    const [qwenEndpoint, setQwenEndpoint] = useState<string>('http://127.0.0.1:8765');
    const [isLoadingEndpoint, setIsLoadingEndpoint] = useState<boolean>(false);

    // Sync uiProvider when backend config changes
    useEffect(() => {
        setUiProvider(transcriptModelConfig.provider);
        // Load saved endpoint from backend when provider changes to qwen3
        if (transcriptModelConfig.provider === 'qwen3') {
            loadQwenEndpointFromBackend();
        }
    }, [transcriptModelConfig.provider]);

    // NEW: Load endpoint from backend on mount
    useEffect(() => {
        // If qwen3 is already selected on mount, load endpoint
        if (uiProvider === 'qwen3') {
            loadQwenEndpointFromBackend();
        }
    }, []);

    // NEW: Function to load endpoint from backend
    const loadQwenEndpointFromBackend = async () => {
        if (isLoadingEndpoint) return;
        setIsLoadingEndpoint(true);
        try {
            console.log('📡 Loading Qwen3 endpoint from backend...');
            const config = await invoke('api_get_transcript_config') as any;
            console.log('📡 Backend config:', config);
            
            if (config && config.endpoint) {
                console.log('✅ Loaded endpoint from backend:', config.endpoint);
                setQwenEndpoint(config.endpoint);
                // Also save to localStorage as backup
                localStorage.setItem('qwen3-endpoint', config.endpoint);
            } else {
                // Fallback to localStorage then default
                const saved = localStorage.getItem('qwen3-endpoint');
                if (saved) {
                    console.log('📡 Loaded endpoint from localStorage:', saved);
                    setQwenEndpoint(saved);
                } else {
                    console.log('📡 Using default endpoint: http://127.0.0.1:8765');
                }
            }
        } catch (error) {
            console.error('❌ Failed to load Qwen3 endpoint from backend:', error);
            // Try localStorage as fallback
            const saved = localStorage.getItem('qwen3-endpoint');
            if (saved) {
                setQwenEndpoint(saved);
            }
        } finally {
            setIsLoadingEndpoint(false);
        }
    };

    useEffect(() => {
        if (transcriptModelConfig.provider === 'localWhisper' || transcriptModelConfig.provider === 'parakeet' || transcriptModelConfig.provider === 'qwen3') {
            setApiKey(null);
        }
    }, [transcriptModelConfig.provider]);

    const fetchApiKey = async (provider: string) => {
        try {
            const data = await invoke('api_get_transcript_api_key', { provider }) as string;
            setApiKey(data || '');
        } catch (err) {
            console.error('Error fetching API key:', err);
            setApiKey(null);
        }
    };

    const modelOptions = {
        localWhisper: [],
        parakeet: [],
        deepgram: ['nova-2-phonecall'],
        elevenLabs: ['eleven_multilingual_v2'],
        groq: ['llama-3.3-70b-versatile'],
        openai: ['gpt-4o'],
        qwen3: [], // No model selection needed for Qwen3
    };

    // UPDATE: Make Qwen3 require API key (or at least show the field)
    const requiresApiKey = transcriptModelConfig.provider === 'deepgram' || 
                           transcriptModelConfig.provider === 'elevenLabs' || 
                           transcriptModelConfig.provider === 'openai' || 
                           transcriptModelConfig.provider === 'groq' ||
                           transcriptModelConfig.provider === 'qwen3';

    const handleInputClick = () => {
        if (isApiKeyLocked) {
            setIsLockButtonVibrating(true);
            setTimeout(() => setIsLockButtonVibrating(false), 500);
        }
    };

    const handleWhisperModelSelect = (modelName: string) => {
        setTranscriptModelConfig({
            ...transcriptModelConfig,
            provider: 'localWhisper',
            model: modelName
        });
        if (onModelSelect) {
            onModelSelect();
        }
    };

    const handleParakeetModelSelect = (modelName: string) => {
        setTranscriptModelConfig({
            ...transcriptModelConfig,
            provider: 'parakeet',
            model: modelName
        });
        if (onModelSelect) {
            onModelSelect();
        }
    };

    // Add this function
    const debugDatabase = async () => {
        try {
            const result = await invoke('api_debug_database');
            console.log('🔍 Database debug:', result);
            alert(JSON.stringify(result, null, 2));
        } catch (error) {
            console.error('❌ Debug failed:', error);
            alert('Debug failed: ' + error);
        }
    };

    // Add this button in the Qwen3 section
    <Button
        onClick={debugDatabase}
        className="w-full bg-purple-600 hover:bg-purple-700 text-white text-sm"
    >
        🔍 Debug Database
    </Button>

    // UPDATE: Save Qwen3 configuration to backend
    const saveQwen3Config = async () => {
        if (uiProvider === 'qwen3') {
            try {
                console.log('💾 Saving Qwen3 config to backend:', { 
                    endpoint: qwenEndpoint, 
                    apiKey: apiKey || 'local-secret-123' 
                });
                
                await invoke('api_save_transcript_config', {
                    provider: 'qwen3',
                    model: 'Qwen/Qwen3-ASR-0.6B',
                    apiKey: apiKey || 'local-secret-123',
                    endpoint: qwenEndpoint
                });
                
                console.log('✅ Qwen3 config saved successfully');
                // Also save to localStorage as backup
                localStorage.setItem('qwen3-endpoint', qwenEndpoint);
                alert('✅ Qwen3 settings saved successfully!');
            } catch (error) {
                console.error('❌ Failed to save Qwen3 config:', error);
                alert('❌ Failed to save Qwen3 settings. Check console for details.');
            }
        }
    };

    // NEW: Check what endpoint is saved in backend
    const checkSavedEndpoint = async () => {
        try {
            console.log('🔍 Checking saved endpoint...');
            const config = await invoke('api_get_transcript_config') as any;
            console.log('📡 Current transcript config from backend:', config);
            if (config && config.endpoint) {
                alert(`Backend endpoint: ${config.endpoint}`);
            } else {
                alert('No endpoint found in backend');
            }
        } catch (error) {
            console.error('❌ Failed to get config:', error);
            alert('Failed to get config from backend');
        }
    };

    // UPDATE: Test Qwen3 connection
    const testQwen3Connection = async () => {
        if (uiProvider !== 'qwen3') return;
        
        try {
            console.log('🔍 Testing Qwen3 connection to:', qwenEndpoint);
            const result = await invoke('api_test_qwen3_connection', {
                endpoint: qwenEndpoint,
                apiKey: apiKey || 'local-secret-123'
            });
            console.log('✅ Qwen3 connection test successful:', result);
            alert('✅ Qwen3 server is reachable!');
        } catch (error) {
            console.error('❌ Qwen3 connection test failed:', error);
            alert(`❌ Cannot connect to Qwen3 server at ${qwenEndpoint}\n\nMake sure the server is running:\nmlx-qwen3-asr serve --api-key ${apiKey || 'local-secret-123'} --port 8765`);
        }
    };

    return (
        <div>
            <div className="space-y-4 pb-6">
                <div>
                    <Label className="block text-sm font-medium text-gray-700 mb-1">
                        Transcript Model
                    </Label>
                    <div className="flex space-x-2 mx-1">
                        <Select
                            value={uiProvider}
                            onValueChange={(value) => {
                                const provider = value as TranscriptModelProps['provider'];
                                setUiProvider(provider);
                                
                                // UPDATE: Handle Qwen3 selection
                                if (provider === 'qwen3') {
                                    setApiKey('local-secret-123');
                                    setTranscriptModelConfig({
                                        ...transcriptModelConfig,
                                        provider: 'qwen3',
                                        model: 'Qwen/Qwen3-ASR-0.6B',
                                        apiKey: 'local-secret-123'
                                    });
                                    // Load endpoint from backend first
                                    loadQwenEndpointFromBackend();
                                    // Auto-save Qwen3 config after loading
                                    setTimeout(() => saveQwen3Config(), 500);
                                } else if (provider !== 'localWhisper' && provider !== 'parakeet') {
                                    fetchApiKey(provider);
                                }
                            }}
                        >
                            <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                                <SelectValue placeholder="Select provider" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="parakeet">⚡ Parakeet (Recommended - Real-time / Accurate)</SelectItem>
                                <SelectItem value="localWhisper">🏠 Local Whisper (High Accuracy)</SelectItem>
                                <SelectItem value="qwen3">🚀 Qwen3 (MLX - Apple Silicon)</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* UPDATE: Hide model select for Qwen3 */}
                        {uiProvider !== 'localWhisper' && uiProvider !== 'parakeet' && uiProvider !== 'qwen3' && (
                            <Select
                                value={transcriptModelConfig.model}
                                onValueChange={(value) => {
                                    const model = value as TranscriptModelProps['model'];
                                    setTranscriptModelConfig({ ...transcriptModelConfig, provider: uiProvider, model });
                                }}
                            >
                                <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                                    <SelectValue placeholder="Select model" />
                                </SelectTrigger>
                                <SelectContent>
                                    {modelOptions[uiProvider]?.map((model) => (
                                        <SelectItem key={model} value={model}>{model}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                </div>

                {uiProvider === 'localWhisper' && (
                    <div className="mt-6">
                        <ModelManager
                            selectedModel={transcriptModelConfig.provider === 'localWhisper' ? transcriptModelConfig.model : undefined}
                            onModelSelect={handleWhisperModelSelect}
                            autoSave={true}
                        />
                    </div>
                )}

                {uiProvider === 'parakeet' && (
                    <div className="mt-6">
                        <ParakeetModelManager
                            selectedModel={transcriptModelConfig.provider === 'parakeet' ? transcriptModelConfig.model : undefined}
                            onModelSelect={handleParakeetModelSelect}
                            autoSave={true}
                        />
                    </div>
                )}

                {/* UPDATE: Qwen3-specific settings with correct port */}
                {uiProvider === 'qwen3' && (
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <p className="text-sm font-medium text-blue-800 mb-2">
                            🚀 Qwen3 ASR Configuration
                        </p>
                        
                        <div className="space-y-3">
                            <div>
                                <Label className="text-xs text-blue-700">Server Endpoint</Label>
                                <Input
                                    value={qwenEndpoint}
                                    onChange={(e) => {
                                        const newEndpoint = e.target.value;
                                        setQwenEndpoint(newEndpoint);
                                        localStorage.setItem('qwen3-endpoint', newEndpoint);
                                    }}
                                    className="mt-1 text-sm bg-white border-blue-300 focus:ring-blue-500"
                                    placeholder="http://127.0.0.1:8765 <- this is for Mac Meetily (Insert Mac IP address as server endpoint if using Qwen3 with Windows Meetily app)"
                                    disabled={isLoadingEndpoint}
                                />
                                <p className="text-xs text-blue-600 mt-1">
                                    Current: {qwenEndpoint}
                                </p>
                            </div>
                            
                            <div className="bg-blue-100/50 rounded p-3">
                                <p className="text-xs text-blue-700 mb-2">
                                    Start the Qwen3 server by typing the following in mac terminal:
                                </p>
                                <code className="block bg-blue-200 px-3 py-2 rounded text-xs font-mono text-blue-900">
                                    mlx-qwen3-asr serve --api-key {apiKey || 'local-secret-123'} --port 8765 --model mlx-community/Qwen3-ASR-0.6B-8bit
                                </code>
                            </div>

                            <Button
                                onClick={testQwen3Connection}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm"
                            >
                                🔌 Test Connection (404 Not Found means connection is working)
                            </Button>

                            {/* ✅ ADDED: Manual Save Button */}
                            <Button
                                onClick={saveQwen3Config}
                                className="w-full bg-green-600 hover:bg-green-700 text-white text-sm"
                            >
                                💾 Save Qwen3 Settings
                            </Button>

                            {/* NEW: Check saved endpoint button */}
                            <Button
                                onClick={checkSavedEndpoint}
                                className="w-full bg-yellow-600 hover:bg-yellow-700 text-white text-sm"
                            >
                                🔍 Check Saved Endpoint
                            </Button>
                            
                            <p className="text-xs text-gray-500 text-center mt-1">
                                Use the Save button to use Qwen3 or API connection
                            </p>
                        </div>
                    </div>
                )}

                {/* UPDATE: Show API key field for Qwen3 as well */}
                {requiresApiKey && (
                    <div>
                        <Label className="block text-sm font-medium text-gray-700 mb-1">
                            API Key {uiProvider === 'qwen3' && '(default: local-secret-123)'}
                        </Label>
                        <div className="relative mx-1">
                            <Input
                                type={showApiKey ? "text" : "password"}
                                className={`pr-24 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${isApiKeyLocked ? 'bg-gray-100 cursor-not-allowed' : ''
                                    }`}
                                value={apiKey || ''}
                                onChange={(e) => {
                                    setApiKey(e.target.value);
                                    if (uiProvider === 'qwen3') {
                                        setTranscriptModelConfig({
                                            ...transcriptModelConfig,
                                            apiKey: e.target.value || 'local-secret-123'
                                        });
                                        // Auto-save when API key changes
                                        setTimeout(() => saveQwen3Config(), 300);
                                    }
                                }}
                                disabled={isApiKeyLocked}
                                onClick={handleInputClick}
                                placeholder={uiProvider === 'qwen3' ? 'local-secret-123' : "Enter your API key"}
                            />
                            {isApiKeyLocked && (
                                <div
                                    onClick={handleInputClick}
                                    className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-50 rounded-md cursor-not-allowed"
                                />
                            )}
                            <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
                                    className={`transition-colors duration-200 ${isLockButtonVibrating ? 'animate-vibrate text-red-500' : ''
                                        }`}
                                    title={isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"}
                                >
                                    {isApiKeyLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                >
                                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                        {uiProvider === 'qwen3' && (
                            <p className="text-xs text-gray-500 mt-1">
                                The API key must match the one used when starting the Qwen3 server
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}