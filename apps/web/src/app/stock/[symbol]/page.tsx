import { StockDetail } from "@/components/stock-detail";

export default async function StockPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  return <StockDetail symbol={decodeURIComponent(symbol)} />;
}
