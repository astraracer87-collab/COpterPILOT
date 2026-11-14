import { useCallback, useEffect, useRef, useState } from "react";
import { loadMapStyle, saveMapStyle, type MapStyleOption } from "@/lib/geozones";

export function useMapBasemapStyle(): [MapStyleOption, (style: MapStyleOption) => void] {
  const [style, setStyle] = useState<MapStyleOption>("grayscale");
  const userChangedStyle = useRef(false);

  useEffect(() => {
    let active = true;
    loadMapStyle().then((saved) => {
      if (active && !userChangedStyle.current) setStyle(saved);
    });
    return () => {
      active = false;
    };
  }, []);

  const updateStyle = useCallback((next: MapStyleOption) => {
    userChangedStyle.current = true;
    setStyle(next);
    void saveMapStyle(next);
  }, []);

  return [style, updateStyle];
}