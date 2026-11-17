import type { AmenityKey } from "./port.js";

/**
 * Labels for imported amenities, in the guide's languages. Provider codes are mapped to these
 * keys in each adapter; the import stores the labels of the property's first guide language.
 */
export const AMENITY_LABELS: Record<AmenityKey, { es: string; en: string }> = {
  wifi: { es: "Wi-Fi", en: "Wi-Fi" },
  air_conditioning: { es: "Aire acondicionado", en: "Air conditioning" },
  heating: { es: "Calefacción", en: "Heating" },
  kitchen: { es: "Cocina", en: "Kitchen" },
  washer: { es: "Lavadora", en: "Washer" },
  dryer: { es: "Secadora", en: "Dryer" },
  free_parking: { es: "Parqueo gratuito", en: "Free parking" },
  pool: { es: "Piscina", en: "Pool" },
  hot_tub: { es: "Jacuzzi", en: "Hot tub" },
  tv: { es: "Televisión", en: "TV" },
  workspace: { es: "Espacio de trabajo", en: "Dedicated workspace" },
  iron: { es: "Plancha", en: "Iron" },
  hair_dryer: { es: "Secador de pelo", en: "Hair dryer" },
  coffee_maker: { es: "Cafetera", en: "Coffee maker" },
  dishwasher: { es: "Lavaplatos", en: "Dishwasher" },
  microwave: { es: "Microondas", en: "Microwave" },
  refrigerator: { es: "Refrigeradora", en: "Refrigerator" },
  bbq: { es: "Parrilla", en: "BBQ grill" },
  balcony: { es: "Balcón", en: "Balcony" },
  garden: { es: "Jardín", en: "Garden" },
  elevator: { es: "Ascensor", en: "Elevator" },
  gym: { es: "Gimnasio", en: "Gym" },
  beach_access: { es: "Acceso a la playa", en: "Beach access" },
  ocean_view: { es: "Vista al mar", en: "Ocean view" },
  crib: { es: "Cuna", en: "Crib" },
  pets_allowed: { es: "Se aceptan mascotas", en: "Pets allowed" },
  smoke_alarm: { es: "Detector de humo", en: "Smoke alarm" },
  carbon_monoxide_alarm: { es: "Detector de monóxido de carbono", en: "Carbon monoxide alarm" },
  first_aid_kit: { es: "Botiquín", en: "First aid kit" },
  fire_extinguisher: { es: "Extintor", en: "Fire extinguisher" },
  wheelchair_accessible: { es: "Accesible en silla de ruedas", en: "Wheelchair accessible" },
  ev_charger: { es: "Cargador para vehículo eléctrico", en: "EV charger" },
};

export function amenityLabels(keys: readonly AmenityKey[], language: "es" | "en"): string[] {
  return [...new Set(keys)].map((key) => AMENITY_LABELS[key][language]);
}
