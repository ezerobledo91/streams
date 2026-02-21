import { fetch247Categories, fetch247Channels } from "../api";
import { LiveTvBucketPage } from "./LiveTvBucketPage";

export function Page247() {
  return (
    <LiveTvBucketPage
      title="Canales 24/7"
      subtitle="Maratones y repeticiones continuas"
      apiPrefix="/api/247"
      fetchCategories={fetch247Categories}
      fetchChannels={fetch247Channels}
    />
  );
}
