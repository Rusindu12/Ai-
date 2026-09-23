// =====================================================================================
//  Project:   APEX CITY — Open-World Action-Adventure (GTA-style, Mobile/Android)
//  Module:    0 — Core Engine Foundation
//  File:      ObjectPoolDatabase.cs
//  Desc:      Designer-authored ScriptableObject declaring every prefab the game pools
//             (traffic cars, pedestrians, casings, blood FX, skidmarks, muzzle flashes,
//             police units, pickups). ObjectPoolManager instantiates these at boot BEFORE
//             gameplay starts, so no Instantiate spikes occur during play.
//  Usage:     Create via: Assets → Create → OpenWorld → Core → Object Pool Database,
//             then assign it to the ObjectPoolManager component.
// =====================================================================================

using System;
using UnityEngine;

namespace OpenWorld.Core
{
    [CreateAssetMenu(fileName = "ObjectPoolDatabase", menuName = "OpenWorld/Core/Object Pool Database", order = 0)]
    public sealed class ObjectPoolDatabase : ScriptableObject
    {
        /// <summary>
        /// Class (not struct) so newly-added inspector entries inherit these field initializers
        /// as sane defaults instead of Unity's zero values.
        /// </summary>
        [Serializable]
        public sealed class PoolEntry
        {
            [Tooltip("Prefab asset to pool. Must be a project asset, never a scene object.")]
            public GameObject Prefab;

            [Tooltip("Instances created up-front at boot (pre-warm).")]
            public int PrewarmCount = 8;

            [Tooltip("Absolute ceiling of simultaneous instances. Rent returns null beyond this.")]
            public int HardCap = 256;

            [Tooltip("Instances created per expansion burst when the free stack is empty.")]
            public int ExpandBatch = 8;

            [Tooltip("If false, the pool never grows past PrewarmCount; rents are denied instead.")]
            public bool AllowExpansion = true;
        }

        [SerializeField] private PoolEntry[] _entries = Array.Empty<PoolEntry>();

        public int EntryCount => _entries.Length;

        public PoolEntry GetEntry(int index)
        {
            return _entries[index];
        }

        public PoolEntry[] GetEntries()
        {
            return _entries;
        }

        /// <summary>Clamps designer input so invalid data can never reach the runtime pool.</summary>
        private void OnValidate()
        {
            for (int i = 0; i < _entries.Length; i++)
            {
                PoolEntry entry = _entries[i];
                if (entry == null) continue;

                entry.PrewarmCount = Mathf.Max(0, entry.PrewarmCount);
                entry.HardCap = Mathf.Max(1, entry.HardCap);
                entry.ExpandBatch = Mathf.Max(1, entry.ExpandBatch);
                if (entry.PrewarmCount > entry.HardCap) entry.PrewarmCount = entry.HardCap;
                _entries[i] = entry;
            }
        }
    }
}
