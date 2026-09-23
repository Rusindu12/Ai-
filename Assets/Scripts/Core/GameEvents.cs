// =====================================================================================
//  Project:   APEX CITY — Open-World Action-Adventure (GTA-style, Mobile/Android)
//  Module:    0 — Core Engine Foundation
//  File:      GameEvents.cs
//  Desc:      Static, generic, zero-garbage publish/subscribe event bus.
//             Every event payload is a struct implementing IGameEvent and is passed
//             by 'in' through a custom delegate, so publishing never boxes, never
//             allocates, and never constructs closures on the hot path.
//  Contract:  MAIN THREAD ONLY. Subscribe in OnEnable, unsubscribe in OnDisable.
//  Usage:     GameEvents<PlayerDiedEvent>.Subscribe(OnPlayerDied);
//             GameEvents<PlayerDiedEvent>.Publish(new PlayerDiedEvent { ... });
// =====================================================================================

using System;
using UnityEngine;

namespace OpenWorld.Core
{
    /// <summary>
    /// Handler signature for core event hubs. The 'in' modifier passes struct payloads
    /// by readonly reference — no defensive copies, no boxing.
    /// </summary>
    public delegate void GameEventHandler<TEvent>(in TEvent evt) where TEvent : struct, IGameEvent;

    /// <summary>
    /// One static hub is generated per concrete event type at JIT time. Subscriptions are
    /// multicast delegate chains; only Subscribe/Unsubscribe allocate (rare, setup-time).
    /// </summary>
    public static class GameEvents<TEvent> where TEvent : struct, IGameEvent
    {
        private static GameEventHandler<TEvent> _hub;

        /// <summary>True when at least one listener is attached. Cheap guard for publishers that do work to build payloads.</summary>
        public static bool HasSubscribers => _hub != null;

        /// <summary>Listener count. Allocates an invocation list — debug/diagnostics only, never call per-frame.</summary>
        public static int SubscriberCount
        {
            get
            {
                GameEventHandler<TEvent> hub = _hub;
                return hub != null ? hub.GetInvocationList().Length : 0;
            }
        }

        /// <summary>Attach a handler. Call from OnEnable; pair with <see cref="Unsubscribe"/> in OnDisable.</summary>
        public static void Subscribe(GameEventHandler<TEvent> handler)
        {
            if (handler == null) return;
            _hub += handler;
        }

        /// <summary>Detach a handler. MUST be called in OnDisable or the handler leaks across scene loads.</summary>
        public static void Unsubscribe(GameEventHandler<TEvent> handler)
        {
            if (handler == null) return;
            _hub -= handler;
        }

        /// <summary>Dispatch the payload to all subscribers synchronously on the calling (main) thread.</summary>
        public static void Publish(in TEvent evt)
        {
            GameEventHandler<TEvent> hub = _hub;
            if (hub != null) hub.Invoke(in evt);
        }

        /// <summary>Detach every listener. Used on teardown; also wired to Enter-Play-Mode without Domain Reload.</summary>
        public static void ClearAllSubscribers()
        {
            _hub = null;
        }

#if UNITY_EDITOR
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStaticsForEnterPlayMode()
        {
            _hub = null;
        }
#endif
    }
}
