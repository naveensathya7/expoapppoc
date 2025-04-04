import React, { useRef, useEffect, useState } from "react";
import { View, StyleSheet, Button, Text, Alert } from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { Camera } from "expo-camera";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";

export default function App() {
  const webViewRef = useRef(null);
  const [webViewLoaded, setWebViewLoaded] = useState(false);
  const [debugLog, setDebugLog] = useState([]);
  const [recording, setRecording] = useState(null);
  const [recordingStatus, setRecordingStatus] = useState("idle");
  const [audioUri, setAudioUri] = useState(null);

  const addLog = (message) => {
    console.log(message);
    setDebugLog((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  // Enhanced injected JavaScript with improved communication bridge
  const INJECTED_JAVASCRIPT = `
    (function() {
      window.isReactNativeWebView = true;
      
      // Define reliable communication method
      window.sendToExpo = function(message) {
        if (window.ReactNativeWebView) {
          const messageString = typeof message === 'string' ? message : JSON.stringify(message);
          window.ReactNativeWebView.postMessage(messageString);
          console.log('Message sent to Expo:', message);
          return true;
        }
        console.error('ReactNativeWebView not available');
        return false;
      };
      
      // Create a global event system for expo messages
      window.expoMessageHandlers = {};
      window.addExpoMessageListener = function(type, callback) {
        window.expoMessageHandlers[type] = callback;
        console.log('Added handler for message type:', type);
      };
      
      // Process messages from Expo
      window.processExpoMessage = function(messageData) {
        const type = messageData.type;
        if (type && window.expoMessageHandlers[type]) {
          window.expoMessageHandlers[type](messageData);
          return true;
        }
        console.log('No handler found for message type:', type);
        return false;
      };
      
      // Signal that the web app is ready
      setTimeout(() => {
        window.sendToExpo({
          type: 'WEB_READY',
          message: 'Web view is ready to receive messages'
        });
      }, 500);
      
      true;
    })();
  `;

  const handleWebViewMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      addLog(`Received from web: ${JSON.stringify(data)}`);
      console.log(data.type);
      switch (data.type) {
        case "LOCATION":
          getLocationAndSend();
          break;
        case "CAMERA":
          getCameraPermissionAndSend();
          break;
        case "MICROPHONE":
          getMicrophonePermissionAndSend();
          break;
        case "START_RECORDING":
          startRecordingAudio();
          break;
        case "STOP_RECORDING":
          stopRecordingAudio();
          break;
        case "WEB_READY":
          setWebViewLoaded(true);
          addLog("WebView reported ready");
          // Send confirmation back to web app
          sendMessageToWebView({
            type: "EXPO_READY",
            message: "Expo app is ready and connected",
            timestamp: new Date().toISOString(),
          });
          break;
        case "PING":
          // Reply with a pong message
          sendMessageToWebView({
            type: "PONG",
            timestamp: new Date().toISOString(),
            originalTimestamp: data.timestamp,
          });
          break;
        default:
          addLog(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      addLog(`Error handling message: ${error.message}`);
    }
  };

  const startRecordingAudio = async () => {
    try {
      addLog("Starting audio recording...");

      // Send status update to web
      sendMessageToWebView({
        type: "RECORDING_STATUS",
        status: "starting",
        message: "Starting audio recording",
      });

      // Request permission
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        sendMessageToWebView({
          type: "RECORDING_STATUS",
          status: "error",
          message: "Microphone permission denied",
        });
        return;
      }

      // Set audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      // Create recording object
      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      await newRecording.startAsync();

      setRecording(newRecording);
      setRecordingStatus("recording");

      sendMessageToWebView({
        type: "RECORDING_STATUS",
        status: "recording",
        message: "Recording started successfully",
      });

      addLog("Recording started successfully");
    } catch (error) {
      addLog(`Error starting recording: ${error.message}`);
      sendMessageToWebView({
        type: "RECORDING_STATUS",
        status: "error",
        message: `Error starting recording: ${error.message}`,
      });
    }
  };

  const stopRecordingAudio = async () => {
    try {
      if (!recording || recordingStatus !== "recording") {
        addLog("No active recording to stop");
        sendMessageToWebView({
          type: "RECORDING_STATUS",
          status: "error",
          message: "No active recording to stop",
        });
        return;
      }

      addLog("Stopping recording...");

      sendMessageToWebView({
        type: "RECORDING_STATUS",
        status: "stopping",
        message: "Stopping recording",
      });

      // Stop the recording
      await recording.stopAndUnloadAsync();

      // Get recording info
      const uri = recording.getURI();
      setAudioUri(uri);

      // Get file info
      const info = await recording.getStatusAsync();

      addLog(
        `Recording stopped. Duration: ${info.durationMillis}ms, URI: ${uri}`
      );
      const fileContent = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Send the recording info back to the web app
      sendMessageToWebView({
        type: "RECORDING_RESULT",
        status: "success",
        audioData: {
          uri: `data:audio/mp3;base64,${fileContent}`, // Convert to data URI
          duration: info.durationMillis,
          fileSize: info.fileSize || 0,
          format: "audio/mp3", // iOS default format
          timestamp: new Date().toISOString(),
        },
      });

      // Reset recording state
      setRecording(null);
      setRecordingStatus("idle");
    } catch (error) {
      addLog(`Error stopping recording: ${error.message}`);
      sendMessageToWebView({
        type: "RECORDING_STATUS",
        status: "error",
        message: `Error stopping recording: ${error.message}`,
      });

      // Reset recording state on error
      setRecording(null);
      setRecordingStatus("idle");
    }
  };

  const getLocationAndSend = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "Location access is required.");
        sendMessageToWebView({
          type: "LOCATION",
          success: false,
          error: "Permission denied",
        });
        return;
      }

      addLog("Getting location...");
      let location = await Location.getCurrentPositionAsync({});
      addLog(
        `Location obtained: ${location.coords.latitude}, ${location.coords.longitude}`
      );

      sendMessageToWebView({
        type: "LOCATION",
        success: true,
        location: {
          coords: {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
            altitude: location.coords.altitude,
            heading: location.coords.heading,
            speed: location.coords.speed,
          },
          timestamp: location.timestamp,
        },
      });
    } catch (error) {
      addLog(`Location error: ${error.message}`);
      sendMessageToWebView({
        type: "LOCATION",
        success: false,
        error: error.message,
      });
    }
  };

  const getCameraPermissionAndSend = async () => {
    try {
      let { status } = await Camera.requestCameraPermissionsAsync();
      console.log(status);
      sendMessageToWebView({
        type: "CAMERA",
        success: status === "granted",
        error: status !== "granted" ? "Permission denied" : null,
      });
    } catch (error) {
      addLog(`Camera error: ${error.message}`);
      sendMessageToWebView({
        type: "CAMERA",
        success: false,
        error: error.message,
      });
    }
  };

  const getMicrophonePermissionAndSend = async () => {
    try {
      let { status } = await Audio.requestPermissionsAsync();
      console.log(status);
      sendMessageToWebView({
        type: "MICROPHONE",
        success: status === "granted",
        error: status !== "granted" ? "Permission denied" : null,
      });
    } catch (error) {
      addLog(`Microphone error: ${error.message}`);
      sendMessageToWebView({
        type: "MICROPHONE",
        success: false,
        error: error.message,
      });
    }
  };

  const sendMessageToWebView = (message) => {
    if (!webViewRef.current) {
      addLog("WebView reference is null");
      return;
    }

    const messageString = JSON.stringify(message);
    addLog(`Sending to web: ${messageString}`);

    // Improved message injection with reliable processing
    const injectedCode = `
      (function() {
        const message = ${messageString};
        console.log('Received message from Expo:', message);
        
        if (window.processExpoMessage) {
          window.processExpoMessage(message);
        } else {
          // Fallback for legacy processing
          const event = new MessageEvent('message', {
            data: message,
            origin: 'expo-app'
          });
          window.dispatchEvent(event);
        }
        true;
      })();
    `;

    webViewRef.current.injectJavaScript(injectedCode);
  };

  const sendTestMessage = () => {
    sendMessageToWebView({
      type: "TEST",
      message: "Test message from Expo",
      timestamp: new Date().toISOString(),
    });
  };

  // Send a ping message to check connection
  const pingWebView = () => {
    sendMessageToWebView({
      type: "PING",
      timestamp: new Date().toISOString(),
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Expo WebView App</Text>
        <Text style={styles.status}>
          WebView status: {webViewLoaded ? "Loaded" : "Loading..."}
        </Text>
        <Text style={styles.status}>Recording status: {recordingStatus}</Text>
        <View style={styles.buttonContainer}>
          <Button title="Send Test Message" onPress={sendTestMessage} />
          <Button title="Ping WebView" onPress={pingWebView} />
        </View>
      </View>

      <WebView
        ref={webViewRef}
        source={{ uri: "https://8af1-49-206-56-71.ngrok-free.app" }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        onMessage={handleWebViewMessage}
        injectedJavaScript={INJECTED_JAVASCRIPT}
        onLoadStart={() => addLog("WebView loading started")}
        onLoadEnd={() => {
          addLog("WebView loading finished");
          // Send a ready message after a short delay
          setTimeout(() => {
            sendMessageToWebView({
              type: "EXPO_INIT",
              message: "Expo app initialized",
              timestamp: new Date().toISOString(),
            });
          }, 1000);
        }}
        onError={(error) =>
          addLog(`WebView error: ${error.nativeEvent.description}`)
        }
        onHttpError={(error) =>
          addLog(`WebView HTTP error: ${error.nativeEvent.statusCode}`)
        }
        style={styles.webview}
      />

      <View style={styles.debugContainer}>
        <Text style={styles.debugHeader}>Debug Log:</Text>
        <View style={styles.logContainer}>
          {debugLog.slice(-5).map((log, index) => (
            <Text key={index} style={styles.logText}>
              {log}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 40,
  },
  header: {
    padding: this?.SPACING,
    backgroundColor: "#f0f0f0",
  },
  headerText: {
    fontSize: 18,
    fontWeight: "bold",
  },
  status: {
    marginVertical: 5,
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
  },
  webview: {
    flex: 1,
  },
  debugContainer: {
    padding: 10,
    backgroundColor: "#333",
    maxHeight: 150,
  },
  debugHeader: {
    color: "#fff",
    fontWeight: "bold",
    marginBottom: 5,
  },
  logContainer: {
    backgroundColor: "#222",
    padding: 5,
  },
  logText: {
    color: "#0f0",
    fontSize: 12,
  },
});
