import { useState, useEffect, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { RoundResult, LeaderboardEntry } from '../types';
import { formatStars } from '../utils/scoring';

interface Props {
  results: RoundResult[];
  mode: 'daily' | 'unlimited';
  date?: string;
  onSubmitToLeaderboard?: (nickname: string) => Promise<{ rank: number; score: number }>;
  onPlayAgain: () => void;
}

function roundEmoji(score: number): string {
  if (score >= 900) return '🟩';
  if (score >= 600) return '🟨';
  if (score >= 300) return '🟧';
  return '🟥';
}

const EPOCH_MS = new Date('2026-05-25').getTime();

function dailyNumber(date: string): number {
  return Math.round((new Date(date).getTime() - EPOCH_MS) / 86_400_000) + 1;
}

function buildShareText(
  results: RoundResult[],
  totalScore: number,
  mode: 'daily' | 'unlimited',
  date?: string,
): string {
  const blocks = results.map(r => roundEmoji(r.score)).join('');
  const header = mode === 'daily' && date
    ? `⭐ Starguessr #${dailyNumber(date)}`
    : '⭐ Starguessr';
  return [
    header,
    '',
    blocks,
    `I scored ${totalScore.toLocaleString()} points guessing GitHub repo stars on ${window.location.origin}`,
  ].join('\n');
}

export function Scoreboard({ results, mode, date, onSubmitToLeaderboard, onPlayAgain }: Props) {
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ rank: number; score: number } | null>(null);
  const [submittedNickname, setSubmittedNickname] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);

  const totalScore = results.reduce((s, r) => s + r.score, 0);

  useEffect(() => {
    if (totalScore === 0) return;
    const ratio = totalScore / 5000;
    // canvas-confetti floors particleCount, so keep it >= 1
    const count = Math.max(1, Math.round(ratio * 5));
    const duration = Math.max(500, Math.round(ratio * 3000));
    const end = Date.now() + duration;
    const frame = () => {
      void confetti({ particleCount: count, angle: 60, spread: 55, origin: { x: 0 } });
      void confetti({ particleCount: count, angle: 120, spread: 55, origin: { x: 1 } });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, [totalScore]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const url = mode === 'daily' && date
        ? `/api/leaderboard/daily?date=${date}`
        : '/api/leaderboard/unlimited';
      const res = await fetch(url);
      if (res.ok) setLeaderboard(await res.json() as LeaderboardEntry[]);
    } catch {
      // ignore network errors
    }
  }, [mode, date]);

  useEffect(() => { void fetchLeaderboard(); }, [fetchLeaderboard]);

  const handleSubmit = async () => {
    if (!onSubmitToLeaderboard || submitted) return;
    const nick = nickname.trim();
    if (nick.length < 2) { setError('Nickname must be at least 2 characters'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await onSubmitToLeaderboard(nick);
      setSubmitResult(res);
      setSubmittedNickname(nick);
      setSubmitted(true);
      void fetchLeaderboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  // Build the rows to show in the leaderboard table
  const leaderboardRows = (() => {
    if (!leaderboard) return null;

    if (submitted && submittedNickname) {
      // After submission: show top 10, highlight the user's actual entry
      return leaderboard.slice(0, 10).map((e, i) => ({
        rank: i + 1,
        nickname: e.nickname,
        score: e.score,
        isUser: e.nickname === submittedNickname,
      }));
    }

    // Before submission: insert a projected "You" row at the right position
    const top = leaderboard.slice(0, 10);
    const rows: { rank: number; nickname: string; score: number; isUser: boolean }[] = [];
    let userInserted = false;
    let rank = 1;

    for (const entry of top) {
      if (!userInserted && entry.score < totalScore) {
        rows.push({ rank: rank++, nickname: 'You', score: totalScore, isUser: true });
        userInserted = true;
      }
      rows.push({ rank: rank++, nickname: entry.nickname, score: entry.score, isUser: false });
    }
    if (!userInserted) {
      rows.push({ rank: rank, nickname: 'You', score: totalScore, isUser: true });
    }

    return rows;
  })();

  const projectedRank = leaderboard
    ? leaderboard.filter(e => e.score > totalScore).length + 1
    : null;

  const shareText = buildShareText(results, totalScore, mode, date);

  const encodedText = encodeURIComponent(shareText);
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
  const bskyUrl = `https://bsky.app/intent/compose?text=${encodedText}`;

  function handleCopy() {
    void navigator.clipboard.writeText(shareText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="max-w-xl mx-auto p-5 space-y-5">
      {/* Total score */}
      <div className="text-center">
        <div className="text-4xl font-black text-blue-600 tabular-nums">{totalScore.toLocaleString()}</div>
        <div className="text-gray-500 text-sm mt-1">out of 5,000 pts</div>
        {submitResult && (
          <div className="mt-2 text-sm font-medium text-green-700">
            Rank #{submitResult.rank} on the leaderboard!
          </div>
        )}
        {projectedRank != null && !submitted && (
          <div className="mt-1 text-xs text-blue-600 font-medium">
            Projected rank: #{projectedRank}
          </div>
        )}
      </div>

      {/* Round breakdown */}
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
        {results.map((r, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50">
            <span className="text-xs text-gray-400 w-6 shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate">{r.owner}/{r.repoName}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Guess: {formatStars(r.guess)} · Actual: {formatStars(r.stars)}
              </div>
            </div>
            <span className="text-sm font-bold text-blue-600 tabular-nums shrink-0">{r.score}</span>
          </div>
        ))}
      </div>

      {/* Leaderboard */}
      {leaderboardRows && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5">
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              {mode === 'daily' ? "Today's Leaderboard" : 'Leaderboard'}
            </span>
          </div>
          {leaderboardRows.length === 0 ? (
            <div className="px-4 py-5 text-center text-sm text-gray-400">No entries yet — be the first!</div>
          ) : (
            leaderboardRows.map((row, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-0 ${
                  row.isUser ? 'bg-blue-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                }`}
              >
                <span className="text-xs text-gray-400 w-5 shrink-0 tabular-nums">{row.rank}</span>
                <span className={`flex-1 text-sm truncate ${row.isUser ? 'text-blue-700 font-semibold' : 'text-gray-800'}`}>
                  {row.nickname}
                  {row.isUser && !submitted && (
                    <span className="ml-1 text-xs text-blue-400 font-normal">(you)</span>
                  )}
                </span>
                <span className={`text-sm font-bold tabular-nums ${row.isUser ? 'text-blue-600' : 'text-gray-600'}`}>
                  {row.score.toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Submit to leaderboard */}
      {!submitted && onSubmitToLeaderboard && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">Add your name to the leaderboard</p>
          <div className="flex gap-2">
            <input
              type="text"
              maxLength={20}
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleSubmit()}
              placeholder="Your nickname"
              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => void handleSubmit()}
              disabled={submitting || nickname.trim().length < 2}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {submitting ? '…' : 'Submit'}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}

      {/* Share */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Share your result</p>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex-1 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
          <a
            href={twitterUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition-colors text-center"
          >
            𝕏 Twitter
          </a>
          <a
            href={bskyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 bg-[#0085ff] text-white text-sm font-medium rounded-lg hover:bg-[#0070d4] transition-colors text-center"
          >
            🦋 Bluesky
          </a>
        </div>
      </div>

      <button
        onClick={onPlayAgain}
        className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        Play Again
      </button>
    </div>
  );
}
