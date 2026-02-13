import type { Category } from "../types";

const labels: Record<Category, string> = {
  movie: "Peliculas",
  series: "Series",
  tv: "Canales"
};

export function CategoryTabs({
  activeCategory,
  onChange
}: {
  activeCategory: Category;
  onChange: (category: Category) => void;
}) {
  const categories: Category[] = ["movie", "series", "tv"];

  return (
    <div className="tabs">
      {categories.map((category) => (
        <button
          key={category}
          type="button"
          className={`tab ${activeCategory === category ? "is-active" : ""}`}
          onClick={() => onChange(category)}
        >
          {labels[category]}
        </button>
      ))}
    </div>
  );
}

export function categoryTitle(category: Category): string {
  return labels[category];
}
