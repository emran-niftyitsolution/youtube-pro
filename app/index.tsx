import { useFocusEffect } from "@react-navigation/native";
import * as Brightness from "expo-brightness";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Dimensions,
  GestureResponderEvent,
  Linking,
  PanResponder,
  PanResponderGestureState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

export default function App() {
  const webViewRef = useRef<WebView>(null); // WebView reference for controlling JS injection
  const [canGoBack, setCanGoBack] = useState<boolean>(false);
  const [currentBrightness, setCurrentBrightness] = useState<number>(0.5); // Current brightness
  const [currentVolume, setCurrentVolume] = useState<number>(0.5); // Current volume
  const [overlayText, setOverlayText] = useState<string>(""); // Overlay feedback text
  const [showOverlay, setShowOverlay] = useState<boolean>(false); // Overlay visibility
  const [videoPlaying, setVideoPlaying] = useState<boolean>(false); // Track if video is playing
  const [videoDimensions, setVideoDimensions] = useState<{
    width: number;
    height: number;
    top: number;
    left: number;
  }>({
    width: 0,
    height: 0,
    top: 0,
    left: 0,
  });
  const [downloadUrl, setDownloadUrl] = useState<string>("");

  // Handle back press on Android
  const handleBackPress = () => {
    if (canGoBack && webViewRef.current) {
      webViewRef.current.goBack();
      return true;
    } else {
      Alert.alert("Exit App", "Do you want to exit the app?", [
        { text: "No", style: "cancel" },
        { text: "Yes", onPress: () => BackHandler.exitApp() },
      ]);
      return true;
    }
  };

  // Add listener for back button
  useFocusEffect(
    useCallback(() => {
      BackHandler.addEventListener("hardwareBackPress", handleBackPress);

      return () =>
        BackHandler.removeEventListener("hardwareBackPress", handleBackPress);
    }, [canGoBack])
  );

  // Fetch initial brightness when the app starts
  useEffect(() => {
    const fetchInitialBrightness = async () => {
      try {
        const brightness = await Brightness.getBrightnessAsync();
        setCurrentBrightness(brightness);
      } catch (error) {
        console.error("Failed to fetch brightness:", error);
      }
    };
    fetchInitialBrightness();
  }, []);

  // Inject JavaScript to block ads, control video volume, and detect video state
  const injectedJS = `
    const videoElement = document.querySelector('video');
    
    // Hide YouTube ads by targeting known ad classes and IDs
    const hideAds = () => {
      let adSelectors = [
        '.video-ads',  // YouTube video ads container
        '.ytp-ad-module',  // In-video ad module
        '#player-ads',  // Player ads
        '.ytp-ad-player-overlay' // Overlay ads
      ];
      adSelectors.forEach(selector => {
        let ads = document.querySelectorAll(selector);
        ads.forEach(ad => ad.style.display = 'none');
      });
    };

    // Function to change video volume
    const changeVideoVolume = (delta) => {
      if (videoElement) {
        let newVolume = Math.max(0, Math.min(1, videoElement.volume + delta));
        videoElement.volume = newVolume;
      }
    };

    // Function to monitor if video is playing or paused
    const monitorVideoState = () => {
      if (!videoElement) return;

      videoElement.addEventListener('play', () => {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'VIDEO_PLAYING', playing: true, src: videoElement.currentSrc }));
      });

      videoElement.addEventListener('pause', () => {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'VIDEO_PLAYING', playing: false, src: videoElement.currentSrc }));
      });

      // Send video element dimensions
      const rect = videoElement.getBoundingClientRect();
      window.ReactNativeWebView.postMessage(JSON.stringify({ 
        type: 'VIDEO_DIMENSIONS', 
        width: rect.width, 
        height: rect.height, 
        top: rect.top, 
        left: rect.left 
      }));

      // Initial video state
      if (!videoElement.paused) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'VIDEO_PLAYING', playing: true, src: videoElement.currentSrc }));
      } else {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'VIDEO_PLAYING', playing: false, src: videoElement.currentSrc }));
      }
    };

    // Run the ad blocker every second to catch dynamically loaded ads
    setInterval(hideAds, 1000);

    // Monitor video state
    monitorVideoState();
  `;

  // Handle WebView navigation change
  const onNavigationStateChange = (navState: {
    canGoBack: boolean | null | undefined;
  }) => {
    if (navState && typeof navState.canGoBack === "boolean") {
      setCanGoBack(navState.canGoBack);
    }
  };

  // Handle WebView messages
  const onMessage = (event: WebViewMessageEvent) => {
    const data = JSON.parse(event.nativeEvent.data);

    if (data.type === "VIDEO_PLAYING") {
      setVideoPlaying(data.playing);
      if (data.src) {
        setDownloadUrl(data.src); // Set the video URL to download
      }
    } else if (data.type === "VIDEO_DIMENSIONS") {
      console.log("Video dimensions received:", data);
      setVideoDimensions({
        width: data.width,
        height: data.height,
        top: data.top,
        left: data.left,
      });
    }
  };

  // Adjust Brightness
  const changeBrightness = async (delta: number) => {
    const newBrightness = Math.max(0, Math.min(1, currentBrightness + delta));
    try {
      await Brightness.setBrightnessAsync(newBrightness);
      setCurrentBrightness(newBrightness);
      setOverlayText(`Brightness: ${(newBrightness * 100).toFixed(0)}%`);
      showTemporaryOverlay();
    } catch (error) {
      console.error("Failed to adjust brightness:", error);
    }
  };

  // Adjust Video Volume inside the WebView (using injected JS)
  const changeVolume = (delta: number) => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`changeVideoVolume(${delta});`);
      const newVolume = Math.max(0, Math.min(1, currentVolume + delta));
      setCurrentVolume(newVolume);
      setOverlayText(`Volume: ${(newVolume * 100).toFixed(0)}%`);
      showTemporaryOverlay();
    } else {
      console.warn("WebView reference is null or undefined");
    }
  };

  // Show overlay temporarily for feedback
  const showTemporaryOverlay = () => {
    setShowOverlay(true);
    setTimeout(() => {
      setShowOverlay(false);
    }, 1000); // Hide after 1 second
  };

  // PanResponder for swipe-based brightness/volume control (only if video is playing)
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => videoPlaying,
    onPanResponderMove: (
      evt: GestureResponderEvent,
      gestureState: PanResponderGestureState
    ) => {
      const { dx, dy, moveX } = gestureState;

      // Left side of the screen controls brightness
      if (moveX < screenWidth / 2) {
        if (Math.abs(dy) > Math.abs(dx)) {
          const brightnessChange = dy < 0 ? 0.05 : -0.05; // Increase brightness on upward swipe, decrease on downward swipe
          changeBrightness(brightnessChange);
        }
      }

      // Right side of the screen controls volume
      if (moveX >= screenWidth / 2) {
        if (Math.abs(dy) > Math.abs(dx)) {
          const volumeChange = dy < 0 ? 0.05 : -0.05; // Increase volume on upward swipe, decrease on downward swipe
          changeVolume(volumeChange);
        }
      }
    },
    onPanResponderRelease: () => {},
  });

  // Trigger the download action
  const downloadVideo = () => {
    if (downloadUrl) {
      // Open the download URL (you can handle this differently if needed)
      Linking.openURL(downloadUrl);
    } else {
      Alert.alert("No Video", "No video URL found to download.");
    }
  };

  return (
    <View style={styles.container}>
      <View {...panResponder.panHandlers} style={styles.webviewWrapper}>
        <WebView
          ref={webViewRef}
          source={{ uri: "https://m.youtube.com/" }}
          style={styles.webview}
          onError={() => Alert.alert("Error", "Failed to load the page.")}
          onNavigationStateChange={onNavigationStateChange}
          onMessage={onMessage} // Handle messages from WebView
          injectedJavaScript={injectedJS} // Inject JavaScript for ad-blocking and video volume control
          javaScriptEnabled={true}
          domStorageEnabled={true}
          renderError={() => (
            <View style={styles.errorView}>
              <Text style={styles.errorText}>Oops, something went wrong.</Text>
            </View>
          )}
        />
      </View>

      {/* Download Button */}
      {videoPlaying && (
        <TouchableOpacity style={styles.downloadButton} onPress={downloadVideo}>
          <Text style={styles.downloadText}>Download Video</Text>
        </TouchableOpacity>
      )}

      {/* Overlay for brightness and volume feedback */}
      {showOverlay && (
        <View
          style={[
            styles.overlay,
            {
              top: videoDimensions.top + videoDimensions.height / 2 - 25,
              left: videoDimensions.left + videoDimensions.width / 2 - 75,
            },
          ]}
        >
          <Text style={styles.overlayText}>{overlayText}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Constants.statusBarHeight,
  },
  webviewWrapper: {
    flex: 1,
    position: "relative",
  },
  webview: {
    flex: 1,
  },
  overlay: {
    position: "absolute",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    padding: 20,
    borderRadius: 10,
    zIndex: 10,
    alignItems: "center",
  },
  overlayText: {
    color: "white",
    fontSize: 18,
  },
  errorView: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    fontSize: 18,
    color: "red",
  },
  downloadButton: {
    position: "absolute",
    bottom: 20,
    right: 20,
    backgroundColor: "#ff5722",
    padding: 10,
    borderRadius: 5,
  },
  downloadText: {
    color: "white",
    fontSize: 16,
  },
});
