import React, { useRef, useEffect, useState } from "react";
import { View, StyleSheet, Button, Text, Alert } from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import * as Camera from "expo-camera";
import { Audio } from "expo-av";

export default function App() {
  const webViewRef = useRef(null);
  const [webViewLoaded, setWebViewLoaded] = useState(false);
  const [debugLog, setDebugLog] = useState([]);

  const addLog = (message) => {
    console.log(message);
    setDebugLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  // This script ensures the WebView is properly set up for communication
  const INJECTED_JAVASCRIPT = `
    (function() {
      window.isReactNativeWebView = true;
      
      // Log when the script runs
      console.log('Injected script running in WebView');
      
      // Test if message handler is working
      setTimeout(() => {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'WEB_READY',
          message: 'Web view is ready to receive messages'
        }));
      }, 1000);
      
      true;
    })();
  `;

  const handleWebViewMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      addLog(`Received from web: ${JSON.stringify(data)}`);

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
        case "WEB_READY":
          setWebViewLoaded(true);
          addLog("WebView reported ready");
          break;
        default:
          addLog(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      addLog(`Error handling message: ${error.message}`);
    }
  };

  const getLocationAndSend = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "Location access is required.");
        return;
      }
      
      addLog("Getting location...");
      let location = await Location.getCurrentPositionAsync({});
      addLog(`Location obtained: ${location.coords.latitude}, ${location.coords.longitude}`);
      
      sendMessageToWebView({
        type: "LOCATION",
        location: {
          coords: {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude
          }
        }
      });
    } catch (error) {
      addLog(`Location error: ${error.message}`);
    }
  };

  const getCameraPermissionAndSend = async () => {
    try {
      let { status } = await Camera.requestCameraPermissionsAsync();
      sendMessageToWebView({ 
        type: "CAMERA", 
        success: status === "granted" 
      });
    } catch (error) {
      addLog(`Camera error: ${error.message}`);
    }
  };

  const getMicrophonePermissionAndSend = async () => {
    try {
      let { status } = await Audio.requestPermissionsAsync();
      sendMessageToWebView({ 
        type: "MICROPHONE", 
        success: status === "granted" 
      });
    } catch (error) {
      addLog(`Microphone error: ${error.message}`);
    }
  };

  const sendMessageToWebView = (message) => {
    if (!webViewRef.current) {
      addLog("WebView reference is null");
      return;
    }
    
    const messageString = JSON.stringify(message);
    addLog(`Sending to web: ${messageString}`);
    webViewRef.current.postMessage(messageString);
  };

  const sendTestMessage = () => {
    sendMessageToWebView({ 
      type: "TEST", 
      message: "Test message from Expo", 
      timestamp: new Date().toISOString() 
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Expo WebView App</Text>
        <Text style={styles.status}>
          WebView status: {webViewLoaded ? "Loaded" : "Loading..."}
        </Text>
        <Button title="Send Test Message" onPress={sendTestMessage} />
      </View>
      
      <WebView
        ref={webViewRef}
        source={{ uri: "http://192.168.0.44:5173/" }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        onMessage={handleWebViewMessage}
        injectedJavaScript={INJECTED_JAVASCRIPT}
        onLoadStart={() => addLog("WebView loading started")}
        onLoadEnd={() => addLog("WebView loading finished")}
        onError={(error) => addLog(`WebView error: ${error.nativeEvent.description}`)}
        onHttpError={(error) => addLog(`WebView HTTP error: ${error.nativeEvent.statusCode}`)}
        style={styles.webview}
      />
      
      <View style={styles.debugContainer}>
        <Text style={styles.debugHeader}>Debug Log:</Text>
        <View style={styles.logContainer}>
          {debugLog.slice(-5).map((log, index) => (
            <Text key={index} style={styles.logText}>{log}</Text>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 40
  },
  header: {
    padding: 10,
    backgroundColor: "#f0f0f0"
  },
  headerText: {
    fontSize: 18,
    fontWeight: "bold"
  },
  status: {
    marginVertical: 5
  },
  webview: {
    flex: 1
  },
  debugContainer: {
    padding: 10,
    backgroundColor: "#333",
    maxHeight: 150
  },
  debugHeader: {
    color: "#fff",
    fontWeight: "bold",
    marginBottom: 5
  },
  logContainer: {
    backgroundColor: "#222",
    padding: 5
  },
  logText: {
    color: "#0f0",
    fontSize: 12
  }
});