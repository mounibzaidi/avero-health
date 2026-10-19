import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** A list of fiche ids kept on the device (favourites, recents), shared by every screen. `legacy`: the same list
 * under the app's former name, read until the list is first saved under the new one. */
function storedList(key: string, legacy: string) {
  const read = async (): Promise<string[]> => {
    try {
      const raw = (await AsyncStorage.getItem(key)) ?? (await AsyncStorage.getItem(legacy));
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  };
  return function useStored() {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: [key], queryFn: read, staleTime: Infinity });
    const set = useCallback(
      async (change: (ids: string[]) => string[]) => {
        const next = change(await read());
        // A first read still on its way would land after this and put the old list back.
        await qc.cancelQueries({ queryKey: [key] });
        qc.setQueryData([key], next);
        await AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
      },
      [qc],
    );
    return { ids: q.data ?? [], set };
  };
}

const useFavoriteList = storedList("avero.favorites", "medguides.favorites");
const useRecentList = storedList("avero.recent", "medguides.recent");

/** The fiches starred on this device: they open offline, like the whole library. */
export function useFavorites() {
  const { ids, set } = useFavoriteList();
  const toggle = useCallback((id: string) => set((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id])), [set]);
  return { ids, toggle };
}

/** The last fiches opened on this device, newest first (4 at most). */
export function useRecent() {
  const { ids, set } = useRecentList();
  const add = useCallback((id: string) => set((now) => [id, ...now.filter((x) => x !== id)].slice(0, 4)), [set]);
  return { ids, add };
}
