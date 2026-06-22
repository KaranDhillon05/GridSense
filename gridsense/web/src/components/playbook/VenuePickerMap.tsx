"use client";

import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";

function LocationPicker({
  lat,
  lon,
  onPick,
}: {
  lat?: number;
  lon?: number;
  onPick: (lat: number, lon: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  if (lat == null || lon == null) return null;
  return <Marker position={[lat, lon]} />;
}

export default function VenuePickerMap({
  lat,
  lon,
  onPick,
}: {
  lat?: number;
  lon?: number;
  onPick: (lat: number, lon: number) => void;
}) {
  return (
    <MapContainer center={[lat ?? 12.9716, lon ?? 77.5946]} zoom={13} style={{ height: "100%", width: "100%" }}>
      <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <LocationPicker lat={lat} lon={lon} onPick={onPick} />
    </MapContainer>
  );
}
