const tomTomApiKey = import.meta.env.VITE_TOMTOM_API_KEY;

export const hasTomTomApiKey = Boolean(tomTomApiKey);

function hasCoordinates(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng);
}

export async function calculateTomTomRoute(origin, destination) {
  if (!hasTomTomApiKey) {
    throw new Error('TomTom route service is unavailable.');
  }
  if (!hasCoordinates(origin) || !hasCoordinates(destination)) {
    throw new Error('Valid origin and destination coordinates are required.');
  }

  const locations = `${origin.lng},${origin.lat}:${destination.lng},${destination.lat}`;
  try {
    const response = await fetch(`https://api.tomtom.com/routing/1/calculateRoute/${locations}/json?key=${encodeURIComponent(tomTomApiKey)}`);
    if (!response.ok) {
      throw new Error('Unable to calculate the route.');
    }

    const data = await response.json();
    const route = data.routes?.[0];
    if (!route) {
      throw new Error('No route is available for the selected locations.');
    }

    return {
      geometry: route.legs?.flatMap((leg) => leg.points || []) || [],
      travelTimeSeconds: route.summary?.travelTimeInSeconds ?? null,
      lengthMeters: route.summary?.lengthInMeters ?? null,
    };
  } catch {
    throw new Error('Unable to calculate the route.');
  }
}
