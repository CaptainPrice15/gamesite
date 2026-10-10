import type { ReactNode } from 'react'
import { getGame } from '../games/registry'
import { GAMES } from '../games/registry'

interface LegalPageProps {
  kind: 'privacy' | 'terms'
}

export function LegalPage({ kind }: LegalPageProps): ReactNode {
  if (kind === 'privacy') {
    return (
      <div className="page narrow legal-page">
        <h1>Privacy policy</h1>
        <p className="muted">Last updated: October 2026</p>

        <h2>What we store</h2>
        <p>
          Arcade uses anonymous accounts: no email, password or social login is collected. We store
          a random account id, the display name you choose, your matchmaking rating, your best
          scores, and the history of your online matches. This data powers leaderboards and match
          history.
        </p>

        <h2>What stays on your device</h2>
        <p>
          Settings (volumes, theme, control preferences) and local best scores are saved in your
          browser&apos;s local storage and never leave your device.
        </p>

        <h2>Cookies and tracking</h2>
        <p>
          We set no advertising cookies. If the site operator has enabled privacy-friendly analytics
          (Umami), it records page views and which games are opened — no cookies, no personal data,
          no cross-site tracking.
        </p>

        <h2>Error reporting</h2>
        <p>
          If error reporting (Sentry) is enabled, JavaScript crash reports are sent so bugs can be
          fixed. Reports contain technical details such as the page and stack trace — not your name
          or scores.
        </p>

        <h2>Third-party processors</h2>
        <p>
          Data is processed by Supabase (database and authentication) and Vercel (hosting), each
          under their own privacy policies. We never sell data.
        </p>

        <h2>Cleanup</h2>
        <p>
          Accounts are anonymous and may be cleaned up after long periods of inactivity. You can
          stop using the site at any time; contact the site operator to request deletion of your
          anonymous profile.
        </p>
      </div>
    )
  }

  return (
    <div className="page narrow legal-page">
      <h1>Terms of service</h1>
      <p className="muted">Last updated: October 2026</p>

      <h2>The service</h2>
      <p>
        Arcade is a free collection of browser games ({GAMES.map((game) => game.title).join(', ')})
        provided for casual play. The service is offered as-is, without warranties.
      </p>

      <h2>Fair play</h2>
      <p>
        Ranked matches use server-verified results. Cheating, manipulating scores, or abusing
        matchmaking (for example repeatedly joining and abandoning queues) may lead to voided
        matches, rating penalties, or removal from matchmaking.
      </p>

      <h2>Your account</h2>
      <p>
        Accounts are anonymous. You are responsible for your display name and activity on the
        service. Display names that are abusive or impersonating may be changed or removed.
      </p>

      <h2>Availability</h2>
      <p>
        The service may go offline for maintenance or because free hosting limits are reached. We do
        not guarantee availability, and leaderboards or ratings may be reset if required.
      </p>

      <h2>Liability</h2>
      <p>
        To the maximum extent permitted by law, the operator is not liable for any damages arising
        from use of the service.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change as the arcade evolves. Continued use after changes means you accept
        the updated terms.
      </p>

      <p className="muted">
        Questions? Reach out to the site operator. Game-specific rules live in each game&apos;s “How
        to play” modal (for example {getGame('pong')?.title} is first to 11).
      </p>
    </div>
  )
}
