import { fetchEventosCategories, fetchEventosChannels } from "../api";
import { LiveTvBucketPage } from "./LiveTvBucketPage";

export function EventosPage() {
  return (
    <LiveTvBucketPage
      title="Eventos en vivo"
      subtitle="Deportes, PPV y transmisiones especiales"
      apiPrefix="/api/eventos"
      fetchCategories={fetchEventosCategories}
      fetchChannels={fetchEventosChannels}
    />
  );
}
