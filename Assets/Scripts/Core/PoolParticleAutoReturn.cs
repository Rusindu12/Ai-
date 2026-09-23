// =====================================================================================
//  Project:   APEX CITY — Open-World Action-Adventure (GTA-style, Mobile/Android)
//  Module:    0 — Core Engine Foundation
//  File:      PoolParticleAutoReturn.cs
//  Desc:      Attach to pooled VFX prefabs (muzzle flashes, blood bursts, explosions,
//             dust puffs). Returns the object to the ObjectPoolManager once the particle
//             system — and optionally its children — stop being alive, or after a hard
//             safety timeout, whichever comes first. The timeout guarantees a stuck
//             looped system can never leak a pool slot.
// =====================================================================================

using UnityEngine;

namespace OpenWorld.Core
{
    [RequireComponent(typeof(ParticleSystem))]
    public sealed class PoolParticleAutoReturn : MonoBehaviour, IPoolable
    {
        [Tooltip("Safety ceiling in seconds; a looping system is force-returned at this point.")]
        [SerializeField] private float _maxLifetimeSeconds = 8f;

        [Tooltip("Include child particle systems in the alive check.")]
        [SerializeField] private bool _includeChildSystems = true;

        [Tooltip("Count the safety ceiling with unscaled time.")]
        [SerializeField] private bool _useUnscaledTime = false;

        private ParticleSystem _rootSystem;
        private float _expireTime;

        private void Awake()
        {
            _rootSystem = GetComponent<ParticleSystem>();
        }

        public void OnRentFromPool()
        {
            _expireTime = (_useUnscaledTime ? Time.unscaledTime : Time.time) + _maxLifetimeSeconds;
        }

        public void OnReturnToPool()
        {
        }

        private void Update()
        {
            if (_useUnscaledTime ? Time.unscaledTime >= _expireTime : Time.time >= _expireTime)
            {
                ReturnNow();
                return;
            }

            if (!_rootSystem.IsAlive(_includeChildSystems)) ReturnNow();
        }

        private void ReturnNow()
        {
            if (ObjectPoolManager.HasInstance) ObjectPoolManager.Instance.Return(gameObject);
            else Destroy(gameObject);
        }
    }
}
