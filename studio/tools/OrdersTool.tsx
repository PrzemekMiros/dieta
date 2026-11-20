import {useCallback, useEffect, useRef, useState} from 'react'
import {useClient, useCurrentUser} from 'sanity'
import './orders.css'

type Order = {
  id: string
  status: string
  total: number
  currency: string
  createdAt: string
  shipping: number
  shippingMethod?: string
}
type List = {
  orders: Order[]
  hasMore: boolean
  page: number
  stats: {count: number; pending: number; revenue: string}
}
type Detail = {
  order: Order
  items: {
    id: string
    name: string
    sku: string
    type: string
    quantity: number
    unitPrice: number
    taxRate: number
  }[]
  payment: {status: string; p24OrderId: string | null} | null
  shipment: {status: string; tracking: string | null} | null
  entitlements: {itemId: string; active: boolean}[]
  audit: {id: string; action: string; createdAt: string}[]
  events: {id: string; kind: string; createdAt: string}[]
}
const labels: Record<string, string> = {
  pending: 'Oczekuje na płatność',
  paid: 'Opłacone',
  cancelled: 'Anulowane',
  payment_review: 'Płatność do sprawdzenia',
  preparing: 'W przygotowaniu',
  shipped: 'Wysłane',
  delivered: 'Dostarczone',
  cod_pending: 'Pobranie — oczekuje',
  cod_collected: 'Pobranie — odebrane',
  cod_cancelled: 'Pobranie — anulowane',
  verified: 'Płatność potwierdzona',
  registering: 'Rejestrowanie płatności',
  registered: 'Płatność zarejestrowana',
  registration_unknown: 'Płatność do sprawdzenia',
  cancel: 'Anulowanie zamówienia',
  'confirm-cod': 'Odbiór pobrania',
  'resend-links': 'Nowe linki do e-booków',
  'resend-email': 'Ponowienie potwierdzenia',
  shipment: 'Aktualizacja przesyłki',
}
const label = (value: string) => labels[value] || value
const money = (value: number, currency = 'PLN') =>
  new Intl.NumberFormat('pl-PL', {style: 'currency', currency}).format(value / 100)
const date = (value: string) => new Date(value).toLocaleString('pl-PL')

function shopUrl() {
  const configured = process.env.SANITY_STUDIO_SHOP_URL
  if (!configured) return ''
  try {
    const url = new URL(configured)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return ''
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    )
      return ''
    return url.origin
  } catch {
    return ''
  }
}

export function OrdersTool() {
  const base = shopUrl()
  const client = useClient({apiVersion: '2021-06-07'})
  const currentUser = useCurrentUser()
  const token = client.config().token
  const [list, setList] = useState<List | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [filters, setFilters] = useState({q: '', status: '', page: 1})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const revision = useRef(0)

  const api = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      if (!token) throw new Error('Brak aktywnej sesji Sanity. Odśwież Studio.')
      let response: Response
      try {
        response = await fetch(`${base}/api/studio/${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          credentials: 'omit',
          headers: {
            ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
            ...(token ? {Authorization: `Bearer ${token}`} : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        })
      } catch {
        throw new Error('Nie udało się połączyć ze sklepem. Sprawdź połączenie i spróbuj ponownie.')
      }
      if (response.status === 401 || response.status === 403) {
        setList(null)
        setDetail(null)
        setNotice('')
      }
      if (!response.headers.get('content-type')?.includes('application/json'))
        throw new Error('API zamówień jest niedostępne pod skonfigurowanym adresem sklepu.')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Nie udało się wykonać operacji.')
      return data as T
    },
    [base, token],
  )

  const refresh = useCallback(async () => {
    const current = ++revision.current
    setLoading(true)
    setError('')
    try {
      const data = await api<List>(
        `orders?${new URLSearchParams({...filters, page: String(filters.page)})}`,
      )
      if (current === revision.current) setList(data)
    } catch (e) {
      if (current === revision.current) setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api, filters])

  useEffect(() => {
    if (base && token) void refresh()
  }, [base, token, refresh])

  async function openOrder(id: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setDetail(await api<Detail>(`orders/${id}`))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function action(action: string, extra = {}) {
    if (!detail) return
    const confirmations: Record<string, string> = {
      cancel:
        'Anulować zamówienie i zwolnić rezerwację magazynową? Upewnij się, że przesyłka nie została przekazana kurierowi.',
      'confirm-cod': 'Potwierdzić rzeczywisty odbiór płatności za pobraniem?',
      'resend-links': 'Wysłać nowe linki do e-booków? Poprzednie linki zostaną unieważnione.',
      'resend-email': 'Ponownie wysłać potwierdzenie zamówienia do klienta?',
    }
    if (confirmations[action] && !window.confirm(confirmations[action])) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api('order', {orderId: detail.order.id, action, ...extra})
      setNotice('Zapisano zmianę. Wiadomość do klienta trafiła do kolejki wysyłki.')
      // Reload authoritative state after every mutation.
      setDetail(await api<Detail>(`orders/${detail.order.id}`))
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!base)
    return (
      <main className="shop-orders">
        <section className="so-card">
          <h1>Zamówienia sklepu</h1>
          <p>Panel oczekuje na połączenie ze sklepem.</p>
          <p>
            Administrator wdrożenia musi ustawić adres sklepu w zmiennej{' '}
            <code>SANITY_STUDIO_SHOP_URL</code> i ponownie wdrożyć Studio.
          </p>
        </section>
      </main>
    )

  return (
    <main className="shop-orders">
      <header className="so-header">
        <div>
          <p className="so-eyebrow">Dietetyka dla Smyka · sklep</p>
          <h1>Zamówienia</h1>
          <p>Obsługa płatności, przesyłek i produktów cyfrowych.</p>
        </div>
        <span className="so-muted">{currentUser?.name || currentUser?.email}</span>
      </header>
      {error && (
        <p role="alert" className="so-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="so-notice">
          {notice}
        </p>
      )}
      {!token ? (
        <section className="so-card">
          <p>Odśwież Studio, aby połączyć panel z Twoją sesją Sanity.</p>
        </section>
      ) : (
        <>
          {list && (
            <div className="so-stats">
              <section className="so-card">
                <span>Wszystkie zamówienia</span>
                <strong>{list.stats.count}</strong>
              </section>
              <section className="so-card">
                <span>Oczekujące</span>
                <strong>{list.stats.pending}</strong>
              </section>
              <section className="so-card">
                <span>Przychód z opłaconych zamówień</span>
                <strong>{money(Number(list.stats.revenue))}</strong>
              </section>
            </div>
          )}
          {detail ? (
            <>
              <button
                disabled={busy || loading}
                onClick={() => {
                  setDetail(null)
                  setNotice('')
                  setError('')
                }}
              >
                ← Lista zamówień
              </button>
              <div className="so-header">
                <div>
                  <h2>Zamówienie {detail.order.id.slice(0, 8)}</h2>
                  <p className="so-muted">
                    {detail.order.id} · {date(detail.order.createdAt)}
                  </p>
                </div>
                <button disabled={busy || loading} onClick={() => void openOrder(detail.order.id)}>
                  Odśwież szczegóły
                </button>
              </div>
              <div className="so-columns">
                <section className="so-card">
                  <h3>Dostawa</h3>
                  <p>Dostawa: {detail.order.shippingMethod || 'Nie dotyczy'}</p>
                </section>
                <section className="so-card">
                  <h3>Płatność</h3>
                  <p>
                    <span className="so-badge">{label(detail.order.status)}</span>
                  </p>
                  <p>{detail.payment ? label(detail.payment.status) : 'Brak płatności'}</p>
                  {detail.payment?.p24OrderId && <p>Numer P24: {detail.payment.p24OrderId}</p>}
                  <strong className="so-total">
                    {money(detail.order.total, detail.order.currency)}
                  </strong>
                  <p>W tym dostawa: {money(detail.order.shipping)}</p>
                </section>
              </div>
              <section className="so-card">
                <h3>Produkty</h3>
                <div className="so-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Produkt</th>
                        <th>Ilość</th>
                        <th>Cena za szt.</th>
                        <th>VAT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {item.name}
                            <small>
                              {item.sku} ·{' '}
                              {item.type === 'digital' ? 'Produkt cyfrowy' : 'Produkt fizyczny'}
                            </small>
                          </td>
                          <td>{item.quantity}</td>
                          <td>{money(item.unitPrice)}</td>
                          <td>{item.taxRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="so-card">
                <h3>Działania</h3>
                <div className="so-actions">
                  <button disabled={busy || loading} onClick={() => void action('resend-email')}>
                    Ponów potwierdzenie
                  </button>
                  {detail.order.status === 'paid' && detail.entitlements.some((e) => e.active) && (
                    <button disabled={busy || loading} onClick={() => void action('resend-links')}>
                      Wyślij nowe linki do e-booków
                    </button>
                  )}
                  {detail.order.status === 'pending' &&
                    detail.payment?.status === 'cod_pending' && (
                      <button disabled={busy || loading} onClick={() => void action('confirm-cod')}>
                        Potwierdź odbiór pobrania
                      </button>
                    )}
                  {detail.order.status === 'pending' &&
                    (detail.payment?.status !== 'cod_pending' ||
                      detail.shipment?.status === 'preparing') && (
                      <button
                        className="so-danger"
                        disabled={busy || loading}
                        onClick={() => void action('cancel')}
                      >
                        Anuluj zamówienie
                      </button>
                    )}
                </div>
              </section>
              {detail.shipment && (
                <section className="so-card">
                  <h3>Przesyłka</h3>
                  <form
                    key={`${detail.order.id}:${detail.shipment.status}:${detail.shipment.tracking}`}
                    className="so-shipment"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void action('shipment', Object.fromEntries(new FormData(e.currentTarget)))
                    }}
                  >
                    <label>
                      Status
                      <select name="status" defaultValue={detail.shipment.status}>
                        {['preparing', 'shipped', 'delivered'].map((s) => (
                          <option key={s} value={s}>
                            {label(s)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Numer przesyłki
                      <input
                        name="tracking"
                        maxLength={150}
                        defaultValue={detail.shipment.tracking || ''}
                      />
                    </label>
                    <button
                      className="so-primary"
                      disabled={
                        busy ||
                        loading ||
                        !(
                          detail.order.status === 'paid' ||
                          (detail.order.status === 'pending' &&
                            detail.payment?.status === 'cod_pending')
                        )
                      }
                    >
                      Zapisz i powiadom klienta
                    </button>
                  </form>
                </section>
              )}
              {!!detail.entitlements.length && (
                <section className="so-card">
                  <h3>Dostęp do e-booków</h3>
                  {detail.entitlements.map((e) => (
                    <p key={e.itemId}>
                      {detail.items.find((i) => i.id === e.itemId)?.name} —{' '}
                      {e.active ? 'aktywny' : 'wyłączony'}
                    </p>
                  ))}
                </section>
              )}
              <div className="so-columns">
                <section className="so-card">
                  <h3>Historia działań</h3>
                  {!detail.audit.length && <p>Brak działań administratora.</p>}
                  {detail.audit.map((a) => (
                    <p key={a.id}>
                      {label(a.action)}
                      <small>{date(a.createdAt)}</small>
                    </p>
                  ))}
                </section>
                <section className="so-card">
                  <h3>Zdarzenia płatności</h3>
                  {!detail.events.length && <p>Brak zdarzeń.</p>}
                  {detail.events.map((e) => (
                    <p key={e.id}>
                      {label(e.kind)}
                      <small>{date(e.createdAt)}</small>
                    </p>
                  ))}
                </section>
              </div>
            </>
          ) : (
            <section className="so-card">
              <form
                className="so-filters"
                onSubmit={(e) => {
                  e.preventDefault()
                  const data = new FormData(e.currentTarget)
                  setFilters({
                    q: String(data.get('q') || ''),
                    status: String(data.get('status') || ''),
                    page: 1,
                  })
                }}
              >
                <label>
                  Szukaj
                  <input
                    name="q"
                    maxLength={200}
                    placeholder="Numer zamówienia"
                    defaultValue={filters.q}
                  />
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={filters.status}>
                    <option value="">Wszystkie</option>
                    {['pending', 'paid', 'cancelled', 'payment_review'].map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="so-primary" disabled={busy || loading}>
                  Filtruj
                </button>
                <button type="button" disabled={busy || loading} onClick={() => void refresh()}>
                  Odśwież
                </button>
              </form>
              {loading ? (
                <p role="status">Pobieranie zamówień…</p>
              ) : (
                list && (
                  <>
                    <div className="so-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Numer / data</th>
                            <th>Status</th>
                            <th>Kwota</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.orders.map((order) => (
                            <tr key={order.id}>
                              <td>
                                <button disabled={busy} onClick={() => void openOrder(order.id)}>
                                  {order.id.slice(0, 8)}
                                </button>
                                <small>{date(order.createdAt)}</small>
                              </td>
                              <td>
                                <span className="so-badge">{label(order.status)}</span>
                              </td>
                              <td>{money(order.total, order.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!list.orders.length && (
                      <p className="so-empty">Brak zamówień spełniających kryteria.</p>
                    )}
                    <nav className="so-pagination" aria-label="Strony zamówień">
                      <button
                        disabled={busy || filters.page === 1}
                        onClick={() => setFilters((f) => ({...f, page: f.page - 1}))}
                      >
                        ← Poprzednia
                      </button>
                      <span>Strona {list.page}</span>
                      <button
                        disabled={busy || !list.hasMore}
                        onClick={() => setFilters((f) => ({...f, page: f.page + 1}))}
                      >
                        Następna →
                      </button>
                    </nav>
                  </>
                )
              )}
            </section>
          )}
        </>
      )}
    </main>
  )
}
