import React from "react";
import { View, StyleSheet } from "react-native";

interface NativeMapPickerProps {
  initialLatitude: number;
  initialLongitude: number;
  markerLatitude: number;
  markerLongitude: number;
  onMarkerDragEnd: (lat: number, lon: number) => void;
  onMapPress: (lat: number, lon: number) => void;
  marginTop: number;
}

export default function NativeMapPicker({
  marginTop,
}: NativeMapPickerProps) {
  return <View style={[styles.container, { marginTop }]} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#E5E5E5",
  },
});
