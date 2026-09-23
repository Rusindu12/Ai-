// =====================================================================================
//  Project:   APEX CITY — Open-World Action-Adventure (GTA-style, Mobile/Android)
//  Module:    0 — Core Engine Foundation
//  File:      PoolAutoReturn.cs
//  Desc:      Attach to short-lived pooled prefabs (bullet casings, blood decals,
//             skidmark segments, debris). Automatically returns the object to the
//             ObjectPoolManager after a lifetime — callers never manage cleanup.
//  Perf:      One float compare per frame on active objects; zero allocations.
// =====================================================================================

using UnityEngine;

namespace OpenWorld.Core
{
    public sealed class PoolAutoReturn : MonoBehaviour, IPoolable
    {
        [Tooltip("Seconds the instance stays in the world before auto-returning.")]
        [SerializeField] private float _lifetime = 4f;

        [Tooltip("Count with unscaled time so FX keep ticking while the game is paused/slow-motion.")]
        [SerializeField] private bool _useUnscaledTime = false;

        private float _expireTime;

        private void OnEnable()
        {
            RestartTimer();
        }

        public void OnRentFromPool()
        {
            RestartTimer();
        }

        public void OnReturnToPool()
        {
        }

        /// <summary>Re-arms the countdown — call after Rent if gameplay code overrode Lifetime at runtime.</summary>
        public void RestartTimer()
        {
            _expireTime = (_useUnscaledTime ? Time.unscaledTime : Time.time) + _lifetime;
        }

        /// <summary>Runtime lifetime override (e.g. longer skidmarks at high speed). Applies on next RestartTimer.</summary>
        public float Lifetime
        {
            get { return _lifetime; }
            set { _lifetime = value > 0f ? value : 0.01f; }
        }

        private void Update()
        {
            float now = _useUnscaledTime ? Time.unscaledTime : Time.time;
            if (now < _expireTime) return;

            if (ObjectPoolManager.HasInstance) ObjectPoolManager.Instance.Return(gameObject);
            else Destroy(gameObject);
        }
    }
}
