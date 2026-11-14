import React, { useState, useEffect } from "react";
import { View, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable, Modal, Platform } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Location from "@/lib/location";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { DataSource } from "@/lib/dataSource";
import { Spacing, Typography } from "@/constants/theme";
import { fetchWeather, WeatherData } from "@/lib/weather";
import { fetchKpIndex, KpIndexData, getKpLabel } from "@/lib/kpindex";
import MapPicker from "@/components/MapPicker";

function getWindDirectionArrow(degrees: number): string {
  const arrows = ["\u2193", "\u2199", "\u2190", "\u2196", "\u2191", "\u2197", "\u2192", "\u2198"];
  const idx = Math.round(((degrees % 360) + 360) % 360 / 45) % 8;
  return arrows[idx];
}

export default function DipulWeatherScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [kpData, setKpData] = useState<KpIndexData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationName, setLocationName] = useState<string>("");
  const [permissionStatus, setPermissionStatus] = useState<Location.PermissionStatus | null>(null);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [selectedMapLocation, setSelectedMapLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isCustomLocation, setIsCustomLocation] = useState(false);

  const loadKpIndex = async () => {
    try {
      const data = await fetchKpIndex();
      setKpData(data);
    } catch {
      setKpData(null);
    }
  };

  const requestLocationAndFetchWeather = async () => {
    setLoading(true);
    setError(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(status);

      if (status !== "granted") {
        setError("Standortzugriff verweigert. Bitte erlaube den Zugriff in den Einstellungen.");
        setLoading(false);
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });

      const [address] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });

      if (address) {
        setLocationName(`${address.city || address.region || ""}, ${address.country || ""}`);
      }

      const [weatherData] = await Promise.all([
        fetchWeather(loc.coords.latitude, loc.coords.longitude),
        loadKpIndex(),
      ]);
      setWeather(weatherData);
    } catch (err) {
      setError("Wetterdaten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    requestLocationAndFetchWeather();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    if (isCustomLocation && location) {
      await fetchWeatherForLocation(location.latitude, location.longitude);
    } else {
      await requestLocationAndFetchWeather();
    }
    setRefreshing(false);
  };

  const fetchWeatherForLocation = async (lat: number, lon: number) => {
    setLoading(true);
    setError(null);
    try {
      const [address] = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lon,
      });
      if (address) {
        setLocationName(`${address.city || address.region || ""}, ${address.country || ""}`);
      } else {
        setLocationName(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
      }
      setLocation({ latitude: lat, longitude: lon });
      const [weatherData] = await Promise.all([
        fetchWeather(lat, lon),
        loadKpIndex(),
      ]);
      setWeather(weatherData);
    } catch (err) {
      setError("Wetterdaten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  const handleMapPress = (latitude: number, longitude: number) => {
    setSelectedMapLocation({ latitude, longitude });
  };

  const handleConfirmLocation = async () => {
    if (selectedMapLocation) {
      setMapModalVisible(false);
      setIsCustomLocation(true);
      await fetchWeatherForLocation(selectedMapLocation.latitude, selectedMapLocation.longitude);
    }
  };

  const handleResetToCurrentLocation = async () => {
    setIsCustomLocation(false);
    setSelectedMapLocation(null);
    await requestLocationAndFetchWeather();
  };

  const openMapModal = () => {
    setSelectedMapLocation(location);
    setMapModalVisible(true);
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  };

  if (loading) {
    return (
      <ThemedView style={[styles.container, { paddingTop: headerHeight + Spacing.xl }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
            Standort wird ermittelt...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (error || !weather) {
    return (
      <ThemedView style={[styles.container, { paddingTop: headerHeight + Spacing.xl }]}>
        <View style={styles.errorContainer}>
          <Feather name="cloud-off" size={48} color={theme.textTertiary} />
          <ThemedText style={[styles.errorText, { color: theme.textSecondary }]}>
            {error || "Keine Wetterdaten verfügbar"}
          </ThemedText>
          <Button title="Erneut versuchen" onPress={requestLocationAndFetchWeather} />
        </View>
      </ThemedView>
    );
  }

  const currentForecast = weather.forecasts[0];

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Pressable onPress={openMapModal} style={styles.locationHeader}>
            <Feather name="map-pin" size={16} color={theme.primary} />
            <ThemedText style={[styles.locationName, { color: theme.primary }]}>
              {isCustomLocation ? locationName : "Aktueller Standort"}
            </ThemedText>
            <Feather name="chevron-right" size={16} color={theme.primary} />
          </Pressable>
          <DataSource>
            <ThemedText style={[styles.sourceLabel, { color: theme.textTertiary }]}>
              Quelle: dipul DFS (DWD ICON-D2)
            </ThemedText>
          </DataSource>
          {isCustomLocation ? (
            <Pressable onPress={handleResetToCurrentLocation} style={styles.resetButton}>
              <Feather name="navigation" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.resetText, { color: theme.textSecondary }]}>
                Zurück zum aktuellen Standort
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <Card style={styles.currentCard}>
          <View style={styles.currentMain}>
            <ThemedText style={styles.temperature}>
              {currentForecast.temperature.toFixed(0)}°C
            </ThemedText>
            <View style={styles.currentDetails}>
              <View style={styles.detailRow}>
                <Feather name="wind" size={16} color={theme.textSecondary} />
                <ThemedText style={[styles.detailText, { color: theme.text }]}>
                  {currentForecast.windSpeed.toFixed(1)} m/s
                </ThemedText>
              </View>
              {currentForecast.windGust ? (
                <View style={styles.detailRow}>
                  <Feather name="zap" size={16} color={theme.statusCaution} />
                  <ThemedText style={[styles.detailText, { color: theme.text }]}>
                    Böen: {currentForecast.windGust.toFixed(1)} m/s
                  </ThemedText>
                </View>
              ) : null}
              <View style={styles.detailRow}>
                <Feather name="droplet" size={16} color={theme.textSecondary} />
                <ThemedText style={[styles.detailText, { color: theme.text }]}>
                  {currentForecast.rain.toFixed(1)} mm/h
                </ThemedText>
              </View>
              <View style={styles.detailRow}>
                <Feather name="cloud" size={16} color={theme.textSecondary} />
                <ThemedText style={[styles.detailText, { color: theme.text }]}>
                  {currentForecast.cloudCover}%
                </ThemedText>
              </View>
            </View>
          </View>
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          WIND IN DER HÖHE
        </ThemedText>

        <Card style={styles.altWindCard}>
          <View style={styles.altWindHeader}>
            <ThemedText style={[styles.altWindColLabel, { color: theme.textTertiary, flex: 1 }]}>
              Höhe
            </ThemedText>
            <ThemedText style={[styles.altWindColLabel, { color: theme.textTertiary, width: 40, textAlign: "center" }]}>
              Richt.
            </ThemedText>
            <ThemedText style={[styles.altWindColLabel, { color: theme.textTertiary, width: 70, textAlign: "right" }]}>
              Wind
            </ThemedText>
            <ThemedText style={[styles.altWindColLabel, { color: theme.textTertiary, width: 70, textAlign: "right" }]}>
              Böen
            </ThemedText>
          </View>
          {currentForecast.windAtAltitude.map((w, idx) => {
            const isStrong = w.speed > 10;
            const gustStrong = w.gust != null && w.gust > 12;
            return (
              <View
                key={w.height}
                style={[
                  styles.altWindRow,
                  idx < currentForecast.windAtAltitude.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.border,
                  },
                ]}
              >
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.xs }}>
                  <Feather name="layers" size={12} color={theme.textTertiary} />
                  <ThemedText style={styles.altWindHeight}>{w.height} m</ThemedText>
                </View>
                <ThemedText style={[styles.altWindArrow, { width: 40, textAlign: "center" }]}>
                  {getWindDirectionArrow(w.direction)}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.altWindValue,
                    { width: 70, textAlign: "right", color: isStrong ? theme.statusCaution : theme.text },
                  ]}
                >
                  {w.speed.toFixed(1)} m/s
                </ThemedText>
                <ThemedText
                  style={[
                    styles.altWindValue,
                    { width: 70, textAlign: "right", color: gustStrong ? theme.statusNoGo : theme.textSecondary },
                  ]}
                >
                  {w.gust != null ? `${w.gust.toFixed(1)} m/s` : "-"}
                </ThemedText>
              </View>
            );
          })}
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          KP INDEX (GEOMAGNETISCH)
        </ThemedText>

        {kpData ? (
          <Card style={styles.kpCard}>
            <View style={styles.kpMain}>
              <View style={[styles.kpValueCircle, { backgroundColor: kpData.color + "20", borderColor: kpData.color }]}>
                <ThemedText style={[styles.kpValue, { color: kpData.color }]}>
                  {kpData.value.toFixed(1)}
                </ThemedText>
                <ThemedText style={[styles.kpValueLabel, { color: kpData.color }]}>KP</ThemedText>
              </View>
              <View style={styles.kpInfo}>
                <ThemedText style={[styles.kpLevel, { color: kpData.color }]}>
                  {getKpLabel(kpData.value)}
                </ThemedText>
                <ThemedText style={[styles.kpDescription, { color: theme.textSecondary }]}>
                  {kpData.description}
                </ThemedText>
              </View>
            </View>
          </Card>
        ) : (
          <Card style={styles.kpCard}>
            <View style={styles.kpUnavailable}>
              <Feather name="activity" size={20} color={theme.textTertiary} />
              <ThemedText style={[styles.kpUnavailableText, { color: theme.textTertiary }]}>
                KP-Index nicht verfügbar
              </ThemedText>
            </View>
          </Card>
        )}

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          HÖHENPROFIL (AGL)
        </ThemedText>

        <Card style={styles.altProfileCard}>
          {currentForecast.temperatureAtAltitude.length > 1 ? (
            <View style={styles.altProfileRow}>
              <ThemedText style={[styles.altProfileLabel, { color: theme.textSecondary }]}>Temp.</ThemedText>
              <View style={styles.altProfileValues}>
                {currentForecast.temperatureAtAltitude.map((t, i) => (
                  <View key={i} style={styles.altProfileCell}>
                    <ThemedText style={[styles.altProfileHeight, { color: theme.textTertiary }]}>{t.height}m</ThemedText>
                    <ThemedText style={styles.altProfileVal}>{t.value.toFixed(1)}°C</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {currentForecast.humidityAtAltitude.length > 1 ? (
            <View style={[styles.altProfileRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
              <ThemedText style={[styles.altProfileLabel, { color: theme.textSecondary }]}>Feuchte</ThemedText>
              <View style={styles.altProfileValues}>
                {currentForecast.humidityAtAltitude.map((h, i) => (
                  <View key={i} style={styles.altProfileCell}>
                    <ThemedText style={[styles.altProfileHeight, { color: theme.textTertiary }]}>{h.height}m</ThemedText>
                    <ThemedText style={styles.altProfileVal}>{h.value.toFixed(0)}%</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {currentForecast.cloudCoverAtAltitude.length > 0 ? (
            <View style={[styles.altProfileRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
              <ThemedText style={[styles.altProfileLabel, { color: theme.textSecondary }]}>Wolken</ThemedText>
              <View style={styles.altProfileValues}>
                {currentForecast.cloudCoverAtAltitude.map((c, i) => (
                  <View key={i} style={styles.altProfileCell}>
                    <ThemedText style={[styles.altProfileHeight, { color: theme.textTertiary }]}>{c.height}m</ThemedText>
                    <ThemedText style={styles.altProfileVal}>{c.value.toFixed(0)}%</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          24-STUNDEN-VORHERSAGE
        </ThemedText>

        <Card style={styles.forecastCard}>
          {weather.forecasts.slice(1).map((forecast, index) => (
            <View
              key={forecast.timestamp}
              style={[
                styles.forecastItem,
                index < weather.forecasts.length - 2 && { borderBottomWidth: 1, borderBottomColor: theme.border },
              ]}
            >
              <ThemedText style={styles.forecastTime}>
                {formatTime(forecast.timestamp)}
              </ThemedText>
              <View style={styles.forecastDetails}>
                <ThemedText style={styles.forecastTemp}>
                  {forecast.temperature.toFixed(0)}°
                </ThemedText>
                <View style={styles.forecastWind}>
                  <Feather name="wind" size={12} color={theme.textSecondary} />
                  <ThemedText style={[styles.forecastWindText, { color: theme.textSecondary }]}>
                    {forecast.windSpeed.toFixed(0)} m/s
                  </ThemedText>
                </View>
                {forecast.windGust ? (
                  <View style={styles.forecastWind}>
                    <Feather name="trending-up" size={12} color={theme.statusCaution} />
                    <ThemedText style={[styles.forecastWindText, { color: theme.statusCaution }]}>
                      {forecast.windGust.toFixed(0)}
                    </ThemedText>
                  </View>
                ) : null}
                {forecast.rain > 0 ? (
                  <View style={[styles.rainBadge, { backgroundColor: theme.statusCautionBackground }]}>
                    <Feather name="droplet" size={10} color={theme.statusCaution} />
                    <ThemedText style={[styles.rainText, { color: theme.statusCaution }]}>
                      {forecast.rain.toFixed(1)}
                    </ThemedText>
                  </View>
                ) : null}
                <ThemedText style={[styles.forecastCloudText, { color: theme.textTertiary }]}>
                  {forecast.cloudCover.toFixed(0)}%
                </ThemedText>
              </View>
            </View>
          ))}
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing.xl }]}>
          HÖHENWIND-VERLAUF (24h)
        </ThemedText>

        <Card style={styles.altForecastCard}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={styles.altForecastHeaderRow}>
                <View style={styles.altForecastLabelCol}>
                  <ThemedText style={[styles.altForecastLabel, { color: theme.textTertiary }]}>Höhe</ThemedText>
                </View>
                {weather.forecasts.map((f) => (
                  <View key={f.timestamp} style={styles.altForecastTimeCol}>
                    <ThemedText style={[styles.altForecastTimeText, { color: theme.textSecondary }]}>
                      {formatTime(f.timestamp)}
                    </ThemedText>
                  </View>
                ))}
              </View>
              {[10, 50, 100, 150].map((height, hIdx) => (
                <View
                  key={height}
                  style={[
                    styles.altForecastDataRow,
                    hIdx < 3 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
                  ]}
                >
                  <View style={styles.altForecastLabelCol}>
                    <ThemedText style={styles.altForecastHeightLabel}>{height}m</ThemedText>
                  </View>
                  {weather.forecasts.map((f) => {
                    const w = f.windAtAltitude.find((wa) => wa.height === height);
                    const speed = w?.speed ?? 0;
                    const isStrong = speed > 10;
                    return (
                      <View key={f.timestamp} style={styles.altForecastTimeCol}>
                        <ThemedText style={[styles.altForecastArrow, { color: theme.textTertiary }]}>
                          {w ? getWindDirectionArrow(w.direction) : "-"}
                        </ThemedText>
                        <ThemedText
                          style={[
                            styles.altForecastWindVal,
                            { color: isStrong ? theme.statusCaution : theme.text },
                          ]}
                        >
                          {speed.toFixed(1)}
                        </ThemedText>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      </ScrollView>

      <Modal
        visible={mapModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setMapModalVisible(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
            <Pressable onPress={() => setMapModalVisible(false)} style={styles.modalCloseButton}>
              <ThemedText style={[styles.modalCloseText, { color: theme.textSecondary }]}>
                Abbrechen
              </ThemedText>
            </Pressable>
            <ThemedText style={styles.modalTitle}>Standort wählen</ThemedText>
            <Pressable
              onPress={handleConfirmLocation}
              style={styles.modalConfirmButton}
              disabled={!selectedMapLocation}
            >
              <ThemedText style={[styles.modalConfirmText, { color: selectedMapLocation ? theme.primary : theme.textTertiary }]}>
                Fertig
              </ThemedText>
            </Pressable>
          </View>

          <MapPicker
            style={styles.map}
            initialRegion={{
              latitude: location?.latitude || 52.52,
              longitude: location?.longitude || 13.405,
              latitudeDelta: 2,
              longitudeDelta: 2,
            }}
            selectedLocation={selectedMapLocation}
            onMapPress={handleMapPress}
          />

          <View style={[styles.mapHint, { backgroundColor: theme.backgroundSecondary }]}>
            <Feather name="info" size={14} color={theme.textSecondary} />
            <ThemedText style={[styles.mapHintText, { color: theme.textSecondary }]}>
              Tippe auf die Karte, um einen Standort auszuwählen
            </ThemedText>
          </View>

          {selectedMapLocation ? (
            <View style={[styles.coordsDisplay, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText style={[styles.coordsText, { color: theme.text }]}>
                {selectedMapLocation.latitude.toFixed(4)}, {selectedMapLocation.longitude.toFixed(4)}
              </ThemedText>
            </View>
          ) : null}
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.body,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  errorText: {
    ...Typography.body,
    textAlign: "center",
  },
  header: {
    marginBottom: Spacing.xl,
  },
  locationHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  locationName: {
    ...Typography.h3,
  },
  sourceLabel: {
    ...Typography.caption,
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  resetText: {
    ...Typography.small,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  modalCloseButton: {
    minWidth: 80,
  },
  modalCloseText: {
    ...Typography.body,
  },
  modalTitle: {
    ...Typography.h3,
    textAlign: "center",
  },
  modalConfirmButton: {
    minWidth: 80,
    alignItems: "flex-end",
  },
  modalConfirmText: {
    ...Typography.body,
    fontWeight: "600",
  },
  map: {
    flex: 1,
  },
  mapHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    borderRadius: 8,
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
  },
  mapHintText: {
    ...Typography.small,
    flex: 1,
  },
  coordsDisplay: {
    padding: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
    borderRadius: 8,
    alignItems: "center",
  },
  coordsText: {
    ...Typography.body,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  currentCard: {
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  currentMain: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  temperature: {
    ...Typography.h1,
    fontSize: 64,
  },
  currentDetails: {
    gap: Spacing.sm,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  detailText: {
    ...Typography.body,
  },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  altWindCard: {
    padding: 0,
    overflow: "hidden",
    marginBottom: Spacing.xl,
  },
  altWindHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  altWindColLabel: {
    ...Typography.caption,
    fontWeight: "600",
    fontSize: 10,
    textTransform: "uppercase",
  },
  altWindRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  altWindHeight: {
    ...Typography.body,
    fontWeight: "600",
  },
  altWindArrow: {
    fontSize: 18,
  },
  altWindValue: {
    ...Typography.body,
    fontWeight: "500",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 13,
  },
  kpCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  kpMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
  },
  kpValueCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  kpValue: {
    ...Typography.h2,
    fontWeight: "800",
    fontSize: 22,
    lineHeight: 24,
  },
  kpValueLabel: {
    ...Typography.caption,
    fontWeight: "700",
    fontSize: 10,
  },
  kpInfo: {
    flex: 1,
  },
  kpLevel: {
    ...Typography.callout,
    fontWeight: "700",
    marginBottom: 4,
  },
  kpDescription: {
    ...Typography.small,
    lineHeight: 18,
  },
  kpUnavailable: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  kpUnavailableText: {
    ...Typography.body,
  },
  altProfileCard: {
    padding: Spacing.md,
    marginBottom: Spacing.xl,
  },
  altProfileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  altProfileLabel: {
    ...Typography.caption,
    fontWeight: "600",
    width: 55,
  },
  altProfileValues: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  altProfileCell: {
    alignItems: "center",
    minWidth: 50,
  },
  altProfileHeight: {
    ...Typography.caption,
    fontSize: 10,
    marginBottom: 2,
  },
  altProfileVal: {
    ...Typography.small,
    fontWeight: "500",
  },
  forecastCard: {
    padding: 0,
    overflow: "hidden",
  },
  forecastItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  forecastTime: {
    ...Typography.body,
    fontWeight: "600",
    width: 60,
  },
  forecastDetails: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
  },
  forecastTemp: {
    ...Typography.body,
    fontWeight: "600",
    width: 40,
    textAlign: "right",
  },
  forecastWind: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    width: 60,
  },
  forecastWindText: {
    ...Typography.small,
  },
  rainBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rainText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  forecastCloudText: {
    ...Typography.caption,
    width: 30,
    textAlign: "right",
  },
  altForecastCard: {
    padding: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  altForecastHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: Spacing.sm,
  },
  altForecastLabelCol: {
    width: 50,
    paddingLeft: Spacing.xs,
  },
  altForecastLabel: {
    ...Typography.caption,
    fontWeight: "600",
    fontSize: 10,
  },
  altForecastTimeCol: {
    width: 55,
    alignItems: "center",
  },
  altForecastTimeText: {
    ...Typography.caption,
    fontWeight: "600",
    fontSize: 10,
  },
  altForecastDataRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  altForecastHeightLabel: {
    ...Typography.small,
    fontWeight: "700",
    fontSize: 12,
  },
  altForecastArrow: {
    fontSize: 14,
    lineHeight: 16,
  },
  altForecastWindVal: {
    ...Typography.caption,
    fontWeight: "600",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});
