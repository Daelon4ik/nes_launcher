import { useCallback, useEffect, useState } from "react";
import { listGames, scanLibrary } from "../api/library";
import type { Game } from "../types/game";

interface UseGameLibraryResult {
  games: Game[];
  loading: boolean;
  error: string | null;
  scan: () => Promise<void>;
}

export function useGameLibrary(): UseGameLibraryResult {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGames()
      .then(setGames)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGames(await scanLibrary());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return { games, loading, error, scan };
}
