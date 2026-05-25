import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { RepoForGame, MultiplayerPlayer, MultiplayerRoundEnd, MultiplayerFinalScore } from '../types';
import { FileTree } from '../components/FileTree';
import { ReadmeViewer } from '../components/ReadmeViewer';
import { CommitsList } from '../components/CommitsList';
import { Timer } from '../components/Timer';
import { formatStars } from '../utils/scoring';

type Phase = 'lobby-entry' | 'lobby-waiting' | 'playing' | 'reveal' | 'countdown' | 'finished';
type MobileTab = 'files' | 'readme' | 'commits';

interface RoundReveal extends MultiplayerRoundEnd {}

function getSocket(): Socket {
  return io({ path: '/socket.io', transports: ['websocket', 'polling'] });
}

export function MultiplayerPage() {
  const navigate = useNavigate();
  const socketRef = useRef<Socket | null>(null);
  const myRoomCodeRef = useRef('');
  const myPlayerIdRef = useRef('');

  const [phase, setPhase] = useState<Phase>('lobby-entry');
  const [entry, setEntry] = useState<'create' | 'join'>('create');
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [myRoomCode, setMyRoomCode] = useState('');
  const [myPlayerId, setMyPlayerId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [players, setPlayers] = useState<MultiplayerPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [currentRound, setCurrentRound] = useState(0);
  const [currentRepo, setCurrentRepo] = useState<RepoForGame | null>(null);
  const [guessValue, setGuessValue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [timerKey, setTimerKey] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(90);

  const [roundReveal, setRoundReveal] = useState<RoundReveal | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [finalScores, setFinalScores] = useState<MultiplayerFinalScore[]>([]);

  const [mobileTab, setMobileTab] = useState<MobileTab>('readme');
  const [contentView, setContentView] = useState<{ type: 'readme' } | { type: 'file'; path: string; name: string }>({ type: 'readme' });
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [readme, setReadme] = useState<string | null>(null);

  const submittedPlayersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      if (myRoomCodeRef.current && myPlayerIdRef.current) {
        socket.emit('room:reconnect', { code: myRoomCodeRef.current, oldPlayerId: myPlayerIdRef.current });
      }
    });

    socket.on('room:created', (data: { code: string; playerId: string; player: MultiplayerPlayer }) => {
      setMyRoomCode(data.code);
      myRoomCodeRef.current = data.code;
      setMyPlayerId(data.playerId);
      myPlayerIdRef.current = data.playerId;
      setIsHost(true);
      setPlayers([data.player]);
      setPhase('lobby-waiting');
    });

    socket.on('room:joined', (data: { playerId: string; players: MultiplayerPlayer[]; code: string }) => {
      setMyPlayerId(data.playerId);
      myPlayerIdRef.current = data.playerId;
      setMyRoomCode(data.code);
      myRoomCodeRef.current = data.code;
      setPlayers(data.players);
      setPhase('lobby-waiting');
    });

    socket.on('room:player:joined', (data: { player: MultiplayerPlayer }) => {
      setPlayers(prev => [...prev.filter(p => p.id !== data.player.id), data.player]);
    });

    socket.on('room:updated', (data: { players: MultiplayerPlayer[]; phase: string; currentRound: number }) => {
      setPlayers(data.players);
    });

    socket.on('room:error', (data: { message: string }) => {
      setError(data.message);
    });

    socket.on('game:start', () => {
      setPhase('playing');
    });

    socket.on('game:round:start', (data: { round: number; repo: RepoForGame; elapsed?: number }) => {
      setCurrentRound(data.round);
      setCurrentRepo(data.repo);
      setGuessValue('');
      setSubmitted(false);
      setPhase('playing');
      setTimerKey(k => k + 1);
      setContentView({ type: 'readme' });
      setFileContent(null);
      submittedPlayersRef.current = new Set();
      const elapsed = data.elapsed ?? 0;
      setSecondsLeft(Math.max(0, 90 - Math.floor(elapsed)));
    });

    socket.on('game:player:submitted', (data: { playerId: string; nickname: string }) => {
      submittedPlayersRef.current.add(data.playerId);
      setPlayers(prev =>
        prev.map(p => (p.id === data.playerId ? { ...p, _submitted: true } as MultiplayerPlayer : p))
      );
    });

    socket.on('game:round:end', (data: RoundReveal) => {
      setRoundReveal(data);
      setPhase('reveal');
      const cd = 20;
      setCountdown(cd);
      const iv = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) { clearInterval(iv); return 0; }
          return c - 1;
        });
      }, 1000);
    });

    socket.on('game:finished', (data: { scores: MultiplayerFinalScore[] }) => {
      setFinalScores(data.scores);
      setPhase('finished');
    });

    socket.on('player:disconnected', (data: { playerId: string; nickname: string }) => {
      setPlayers(prev => prev.map(p => p.id === data.playerId ? { ...p, connected: false } : p));
    });

    socket.on('player:reconnected', (data: { playerId: string }) => {
      setPlayers(prev => prev.map(p => p.id === data.playerId ? { ...p, connected: true } : p));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!currentRepo) return;
    setReadme(null);
    fetch(`/api/repos/${currentRepo.id}/readme`)
      .then(r => r.ok ? r.json() as Promise<{ content: string }> : Promise.resolve({ content: '' }))
      .then(d => setReadme(d.content))
      .catch(() => setReadme(''));
  }, [currentRepo?.id]);

  const handleCreate = () => {
    setError(null);
    socketRef.current?.emit('room:create', { nickname: nickname.trim() });
  };

  const handleJoin = () => {
    setError(null);
    socketRef.current?.emit('room:join', { code: roomCode.trim().toUpperCase(), nickname: nickname.trim() });
  };

  const handleStart = () => {
    socketRef.current?.emit('room:start', { code: myRoomCode });
  };

  const handleGuessSubmit = useCallback(() => {
    if (submitted || !currentRepo) return;
    const parsed = parseInt(guessValue, 10);
    const guess = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setSubmitted(true);
    socketRef.current?.emit('game:guess', { code: myRoomCode, guess });
  }, [submitted, currentRepo, guessValue, myRoomCode]);

  const handleFileSelect = async (path: string, name: string) => {
    if (!currentRepo) return;
    setContentView({ type: 'file', path, name });
    setMobileTab('readme');
    setFileContent(null);
    const res = await fetch(`/api/repos/${currentRepo.id}/file?path=${encodeURIComponent(path)}`);
    if (res.ok) {
      const data = await res.json() as { content: string };
      setFileContent(data.content);
    }
  };

  if (phase === 'lobby-entry') {
    return (
      <div className="grow bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-5">
          <div className="relative flex items-center justify-center mb-1">
            <button onClick={() => navigate('/')} className="absolute left-0 text-gray-400 hover:text-gray-700 text-sm">← Back</button>
            <h1 className="text-xl font-bold text-gray-900">Multiplayer</h1>
          </div>

          <div className="flex gap-2">
            {(['create', 'join'] as const).map(t => (
              <button
                key={t}
                onClick={() => setEntry(t)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  entry === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t === 'create' ? 'Create Room' : 'Join Room'}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nickname</label>
            <input
              type="text"
              maxLength={20}
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="Your nickname"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {entry === 'join' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Room Code</label>
              <input
                type="text"
                maxLength={6}
                value={roomCode}
                onChange={e => setRoomCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={entry === 'create' ? handleCreate : handleJoin}
            disabled={nickname.trim().length < 2 || (entry === 'join' && roomCode.length !== 6)}
            className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {entry === 'create' ? 'Create Room' : 'Join Room'}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'lobby-waiting') {
    return (
      <div className="grow bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-5">
          <div>
            <p className="text-xs text-gray-500 mb-1">Room Code</p>
            <div className="text-3xl font-black font-mono text-gray-900 tracking-widest">{myRoomCode}</div>
            <p className="text-xs text-gray-400 mt-1">Share this with friends</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Players ({players.length})</p>
            {players.map(p => (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${p.connected ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className={p.id === myPlayerId ? 'font-semibold text-blue-700' : 'text-gray-800'}>{p.nickname}</span>
                {p.isHost && <span className="text-xs text-gray-400">(host)</span>}
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {isHost ? (
            <button
              onClick={handleStart}
              disabled={players.length < 2}
              className="w-full py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors"
            >
              {players.length < 2 ? 'Waiting for players…' : 'Start Game'}
            </button>
          ) : (
            <p className="text-sm text-center text-gray-500 animate-pulse">Waiting for host to start…</p>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'reveal' && roundReveal) {
    return (
      <div className="grow bg-gray-50 py-8 px-4">
        <div className="max-w-xl mx-auto space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Round {roundReveal.round + 1} Results</h2>
            <span className="text-sm text-gray-500">Next round in {countdown}s…</span>
          </div>

          <div className="text-center py-4 bg-white rounded-xl border border-gray-200">
            <div className="text-2xl font-black text-amber-500">★ {formatStars(roundReveal.stars)}</div>
            <div className="text-sm text-gray-500 mt-1">actual stars</div>
          </div>

          <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden bg-white">
            {[...roundReveal.reveals]
              .sort((a, b) => b.score - a.score)
              .map((r, i) => {
                const isClosest = i === 0;
                return (
                  <div
                    key={r.playerId}
                    className={`flex items-center gap-3 px-4 py-3 ${isClosest ? 'bg-yellow-50 border-l-4 border-yellow-400' : ''}`}
                  >
                    <span className="text-xs text-gray-400 w-5 shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${r.playerId === myPlayerId ? 'text-blue-700' : 'text-gray-800'}`}>
                        {r.nickname} {r.playerId === myPlayerId ? '(you)' : ''}
                      </p>
                      <p className="text-xs text-gray-500">
                        Guess: {r.guess !== null ? formatStars(r.guess) : '—'}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-blue-600 tabular-nums">{r.score}</span>
                    {isClosest && <span className="text-yellow-500 text-lg">🏆</span>}
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'finished') {
    const shareText = `StarGuessr Multiplayer — Room ${myRoomCode}\n` +
      finalScores.map((s, i) => `${i + 1}. ${s.nickname} — ${s.totalScore} pts`).join('\n');

    return (
      <div className="grow bg-gray-50 py-8 px-4">
        <div className="max-w-xl mx-auto space-y-5">
          <h2 className="text-2xl font-black text-gray-900 text-center">Final Scores</h2>

          <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden bg-white">
            {finalScores.map((s, i) => (
              <div
                key={s.playerId}
                className={`flex items-center gap-3 px-4 py-3 ${i === 0 ? 'bg-yellow-50' : ''}`}
              >
                <span className="text-lg shrink-0">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold truncate ${s.playerId === myPlayerId ? 'text-blue-700' : 'text-gray-900'}`}>
                    {s.nickname} {s.playerId === myPlayerId ? '(you)' : ''}
                  </p>
                  <p className="text-xs text-gray-500">
                    {s.roundScores.map((rs, ri) => `R${ri + 1}: ${rs}`).join(' · ')}
                  </p>
                </div>
                <span className="text-lg font-black text-blue-600 tabular-nums">{s.totalScore}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => { void navigator.clipboard.writeText(shareText); }}
              className="flex-1 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50"
            >
              Copy Result
            </button>
            <button
              onClick={() => navigate('/')}
              className="flex-1 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Playing phase
  if (!currentRepo) {
    return (
      <div className="grow bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 animate-pulse">Waiting for round to start…</p>
      </div>
    );
  }

  return (
    <div className="grow bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-4 shrink-0">
        <div className="flex-1 text-sm font-semibold text-gray-800 truncate">
          {currentRepo.owner}/{currentRepo.name}
        </div>
        <span className="text-xs text-gray-500">Round {currentRound + 1}/5</span>
        <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
          {myRoomCode}
        </span>
      </div>

      <div className="sm:hidden flex border-b border-gray-200 bg-white shrink-0">
        {(['files', 'readme', 'commits'] as MobileTab[]).map(t => (
          <button
            key={t}
            onClick={() => setMobileTab(t)}
            className={`flex-1 py-2 text-xs font-medium border-b-2 -mb-px ${
              mobileTab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'
            }`}
          >
            {t === 'files' ? 'Files' : t === 'readme' ? 'README' : 'Commits'}
          </button>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className={`${mobileTab === 'files' ? 'flex' : 'hidden'} sm:flex flex-col w-full sm:w-60 border-r border-gray-200 bg-white overflow-auto shrink-0`}>
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
            Files
          </div>
          <div className="flex-1 overflow-auto py-1">
            <FileTree
              nodes={currentRepo.file_tree}
              onFileSelect={handleFileSelect}
              selectedPath={contentView.type === 'file' ? contentView.path : null}
            />
          </div>
        </aside>

        <main className={`${mobileTab === 'readme' ? 'flex' : 'hidden'} sm:flex flex-col flex-1 overflow-auto bg-white`}>
          <div className="flex-1 overflow-auto">
            {contentView.type === 'file' && fileContent !== null ? (
              <ReadmeViewer content={fileContent} filename={contentView.path} />
            ) : (
              <ReadmeViewer content={readme || '*No README available*'} />
            )}
          </div>
        </main>

        <aside className={`${mobileTab === 'commits' ? 'flex' : 'hidden'} sm:flex flex-col w-full sm:w-80 border-l border-gray-200 bg-white shrink-0`}>
          <div className="flex-1 overflow-auto border-b border-gray-200">
            <CommitsList commits={currentRepo.commits} repoOwner={currentRepo.owner} repoName={currentRepo.name} />
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Players</p>
              <div className="space-y-1">
                {players.map(p => {
                  const hasSubmitted = submittedPlayersRef.current.has(p.id);
                  return (
                    <div key={p.id} className="flex items-center gap-2 text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full ${p.connected ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className={p.id === myPlayerId ? 'font-semibold text-blue-700' : 'text-gray-700'}>{p.nickname}</span>
                      {hasSubmitted && <span className="text-green-600 ml-auto">✓</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-4 space-y-4 shrink-0">
            <Timer
              key={timerKey}
              durationSeconds={secondsLeft}
              running={!submitted}
              onExpire={() => { if (!submitted) { setSubmitted(true); socketRef.current?.emit('game:guess', { code: myRoomCode, guess: 0 }); } }}
            />
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                value={guessValue}
                onChange={e => setGuessValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !submitted && handleGuessSubmit()}
                disabled={submitted}
                placeholder="Your guess…"
                className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <button
                onClick={handleGuessSubmit}
                disabled={submitted || guessValue === ''}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-40"
              >
                {submitted ? '✓' : 'Submit'}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
