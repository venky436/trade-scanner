"use client";

/**
 * Account — follows the global Paper / Real switch:
 *   Real  → your Zerodha account: funds + today's positions (incl. the Kite app)
 *   Paper → the paper balance + today's paper positions
 */
import { useAccount } from "@/components/trading/account-chip";
import { AdminOnly, ModePill, SectionHeader, useTradeConfig } from "@/components/trading/ui";
import { SIDE_TONE, inr, pnlTone, signedInr, timeIst } from "@/lib/trading";

export default function AccountPage() {
  return (
    <AdminOnly>
      <Account />
    </AdminOnly>
  );
}

function Account() {
  const config = useTradeConfig();
  const { account, error } = useAccount(10_000);

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {config?.mode === "PAPER"
              ? `Your paper money: ${inr(config.paperCapital, true)} to start, plus every booked paper profit or loss`
              : "Live from your Zerodha account, including trades placed in the Kite app"}
            {account ? `. Updated ${timeIst(new Date(account.updatedAt).toISOString())}.` : "."}
          </p>
        </div>
        <ModePill config={config} />
      </div>

      {error && !account && (
        <div className="rounded-xl border border-border bg-card px-4 py-8 text-sm text-muted-foreground">
          {error.includes("not connected") ? "Connect Kite in the top bar to see your account." : error}
        </div>
      )}

      {!account && !error && <div className="h-48 rounded-xl bg-muted/30 animate-pulse" />}

      {account && (
        <>
          <section className="rounded-xl border border-border bg-card">
            <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
              <div>
                <div className="text-sm text-muted-foreground">{account.mode === "PAPER" ? "Paper money available" : "Available margin"}</div>
                <div className="mt-1 text-4xl font-semibold tracking-tight tabular-nums text-foreground">{inr(account.funds.available)}</div>
                {account.mode === "LIVE" && account.funds.available <= 0 && (
                  <p className="mt-2 text-sm text-amber-400">No funds yet. Add money in Kite — it shows up here within a few seconds.</p>
                )}
                {account.mode === "PAPER" && <p className="mt-2 text-xs text-muted-foreground">Paper balance {inr(account.funds.cash)}. Not real money.</p>}
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 content-center">
                <Metric label="Used margin" value={inr(account.funds.usedMargin)} />
                <Metric label="Opening balance" value={inr(account.funds.openingBalance)} />
                {account.mode === "LIVE" ? (
                  <>
                    <Metric label="Added today" value={inr(account.funds.addedToday)} />
                    <Metric label="Collateral" value={inr(account.funds.collateral)} />
                  </>
                ) : (
                  <>
                    <Metric label="Paper balance" value={inr(account.funds.cash)} />
                    <Metric label="Started with" value={inr(config?.paperCapital, true)} />
                  </>
                )}
                <Metric label="Today's P&L" value={signedInr(account.totals.pnl)} tone={pnlTone(account.totals.pnl)} />
                <Metric label="Booked" value={signedInr(account.totals.realised)} tone={pnlTone(account.totals.realised)} />
                <Metric label="On open positions" value={signedInr(account.totals.unrealised)} tone={pnlTone(account.totals.unrealised)} />
                <Metric label="Open positions" value={String(account.totals.openPositions)} />
              </dl>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card">
            <SectionHeader
              title="Positions today"
              note={account.mode === "PAPER" ? "Paper trades. P&L is after estimated charges." : "From Zerodha. P&L is gross, before charges."}
            />
            {account.positions.length === 0 ? (
              <p className="px-4 pb-8 pt-2 text-sm text-muted-foreground">No positions today.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-y border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 pl-4 pr-3 font-normal">Stock</th>
                      <th className="py-2 pr-3 font-normal">Product</th>
                      <th className="py-2 pr-3 font-normal text-right">Qty</th>
                      <th className="py-2 pr-3 font-normal text-right">Avg price</th>
                      <th className="py-2 pr-3 font-normal text-right">LTP</th>
                      <th className="py-2 pr-3 font-normal text-right">Bought</th>
                      <th className="py-2 pr-3 font-normal text-right">Sold</th>
                      <th className="py-2 pr-4 font-normal text-right">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.positions.map((p) => {
                      const side = p.quantity > 0 ? "BUY" : p.quantity < 0 ? "SELL" : null;
                      return (
                        <tr key={`${p.exchange}:${p.symbol}:${p.product}`} className="border-b border-border/60 last:border-0">
                          <td className="py-2.5 pl-4 pr-3">
                            <span className="font-medium text-foreground">{p.symbol}</span>
                            <span className="ml-1.5 text-xs text-muted-foreground">{p.exchange}</span>
                          </td>
                          <td className="py-2.5 pr-3 text-muted-foreground">{p.product}</td>
                          <td className={`py-2.5 pr-3 text-right ${side ? SIDE_TONE[side].text : "text-muted-foreground"}`}>
                            {p.quantity === 0 ? "Closed" : p.quantity}
                          </td>
                          <td className="py-2.5 pr-3 text-right">{inr(p.avgPrice)}</td>
                          <td className="py-2.5 pr-3 text-right">{inr(p.ltp)}</td>
                          <td className="py-2.5 pr-3 text-right text-muted-foreground">{p.buyQty}</td>
                          <td className="py-2.5 pr-3 text-right text-muted-foreground">{p.sellQty}</td>
                          <td className={`py-2.5 pr-4 text-right font-medium ${pnlTone(p.pnl)}`}>{signedInr(p.pnl)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${tone ?? "text-foreground"}`}>{value}</dd>
    </div>
  );
}
