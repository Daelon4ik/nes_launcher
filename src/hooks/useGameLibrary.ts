import { useCallback, useEffect, useState } from "react";
import { deleteGame, installGames, listGames, scanLibrary, setFavorite } from "../api/library";
import type { Game } from "../types/game";

interface UseGameLibraryResult {
  games: Game[];
  loading: boolean;
  error: string | null;
  scan: () => Promise<void>;
  install: (paths: string[]) => Promise<void>;
  remove: (gameId: number) => Promise<void>;
  toggleFavorite: (gameId: number, favorite: boolean) => Promise<void>;
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

  const install = useCallback(async (paths: string[]) => {
    setLoading(true);
    setError(null);
    try {
      setGames(await installGames(paths));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (gameId: number) => {
    setLoading(true);
    setError(null);
    try {
      setGames(await deleteGame(gameId));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleFavorite = useCallback(async (gameId: number, favorite: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setGames(await setFavorite(gameId, favorite));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return { games, loading, error, scan, install, remove, toggleFavorite };
}
