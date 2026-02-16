import type { Category } from "../types";

export interface RowConfig {
  id: string;
  title: string;
  genre?: string;
  limit: number;
}

export const HOME_CATEGORY_ROWS: Record<Category, RowConfig[]> = {
  movie: [
    { id: "trending", title: "Tendencias", limit: 24 },
    { id: "action", title: "Accion", genre: "28", limit: 20 },
    { id: "comedy", title: "Comedia", genre: "35", limit: 20 },
    { id: "drama", title: "Drama", genre: "18", limit: 20 },
    { id: "scifi", title: "Ciencia ficcion", genre: "878", limit: 20 },
    { id: "animation", title: "Animacion", genre: "16", limit: 20 },
    { id: "horror", title: "Terror", genre: "27", limit: 20 }
  ],
  series: [
    { id: "trending", title: "Tendencias", limit: 24 },
    { id: "action", title: "Accion y aventura", genre: "10759", limit: 20 },
    { id: "comedy", title: "Comedia", genre: "35", limit: 20 },
    { id: "drama", title: "Drama", genre: "18", limit: 20 },
    { id: "scifi", title: "Sci-Fi y Fantasia", genre: "10765", limit: 20 },
    { id: "animation", title: "Animacion", genre: "16", limit: 20 }
  ],
  tv: []
};

export function buildYearOptions(startYear = 1980): string[] {
  const current = new Date().getFullYear();
  const years: string[] = [];
  for (let year = current; year >= startYear; year -= 1) {
    years.push(String(year));
  }
  return years;
}
