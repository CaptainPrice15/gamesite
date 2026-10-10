import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, GAMES } from '../games/registry'
import { loadBest } from '../core/storage'
import { GameThumb } from '../ui/GameThumb'

export function HomePage(): ReactNode {
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')

  const games = useMemo(() => {
    const q = query.trim().toLowerCase()
    return GAMES.filter((g) => {
      const inCategory = category === 'All' || g.categories.includes(category)
      const inQuery =
        !q ||
        g.title.toLowerCase().includes(q) ||
        g.tagline.toLowerCase().includes(q) ||
        g.categories.some((c) => c.toLowerCase().includes(q))
      return inCategory && inQuery
    })
  }, [category, query])

  return (
    <div className="page">
      <section className="hero">
        <h1>
          Play now.
          <br />
          <span className="accent">No downloads.</span>
        </h1>
        <p className="lede">
          Six browser games — solo, local 2-player, vs a friend by invite code, or ranked
          matchmaking. Free forever.
        </p>
      </section>

      <section className="library" aria-label="Game library">
        <div className="library-tools">
          <div className="chips" role="tablist" aria-label="Categories">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={category === c}
                className={`chip ${category === c ? 'chip-on' : ''}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <input
            className="search"
            type="search"
            placeholder="Search games…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search games"
          />
        </div>

        {games.length === 0 ? (
          <p className="muted empty">No games match “{query}”.</p>
        ) : (
          <ul className="grid">
            {games.map((g) => {
              const best = loadBest(g.id)
              return (
                <li key={g.id}>
                  <Link
                    to={`/play/${g.id}`}
                    className="card"
                    style={{ ['--accent' as string]: g.accent }}
                  >
                    <GameThumb game={g} />
                    <div className="card-body">
                      <div className="card-head">
                        <h2>{g.title}</h2>
                        <span className="badge">{g.players === 1 ? '1P' : '2P'}</span>
                      </div>
                      <p className="tagline">{g.tagline}</p>
                      <div className="card-foot">
                        <span className="chips-sm">
                          {g.categories.map((c) => (
                            <span key={c}>{c}</span>
                          ))}
                        </span>
                        {best > 0 && <span className="best">Best {best}</span>}
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
