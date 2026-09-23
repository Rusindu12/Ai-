// =====================================================================================
//  Project:   APEX CITY — Open-World Action-Adventure (GTA-style, Mobile/Android)
//  Module:    0 — Core Engine Foundation
//  File:      ObjectPoolManager.cs
//  Desc:      Central runtime object pool. Prefab-keyed (instance-id hashing, no string
//             lookups), pre-warmed at boot from ObjectPoolDatabase, hard-capped, with
//             logarithmic burst expansion and delayed returns driven by a zero-GC
//             timer list (no coroutines).
//  Perf:      Rent/Return are allocation-free on the steady-state path:
//               • Dictionary<int, …> keyed by GetInstanceID() — no hashing of strings
//               • free instances live in Stack<int> pops — O(1), no linked-list churn
//               • IPoolable callback arrays captured ONCE per instance at creation
//               • delayed returns use an index-walked List with swap-remove — no LINQ,
//                 no coroutines, no allocations
//  Safety:    Editor/dev-build diagnostics catch double returns, foreign objects,
//             scene-object prefabs and destroyed-instance records before they ship.
//  Setup:     Empty " ObjectPool " GameObject with this component; assign a database.
//             Runs at ExecutionOrder -31900 — before every gameplay script.
// =====================================================================================

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace OpenWorld.Core
{
    [DefaultExecutionOrder(-31900)]
    public sealed class ObjectPoolManager : MonoBehaviour
    {
        // ------------------------------------------------------------------ data structures

        /// <summary>Per-prefab runtime pool state. One instance per unique prefab asset.</summary>
        private sealed class Pool
        {
            public GameObject Prefab;
            public int PrefabId;
            public Transform Container;
            public int PrewarmCount;
            public int HardCap;
            public int ExpandBatch;
            public bool AllowExpansion;
            public Vector3 DefaultLocalScale;
            public readonly Stack<int> FreeInstanceIds = new Stack<int>(64);
            public int CreatedCount;
            public int ActiveCount;
            public int TotalRents;
        }

        /// <summary>Per-live-instance record. Captured callback list avoids per-rent GetComponents.</summary>
        private struct InstanceRecord
        {
            public Pool Pool;
            public GameObject Instance;
            public IPoolable[] Callbacks;
            public bool Active;
        }

        private struct DelayedReturn
        {
            public float ReturnAtTime;
            public GameObject Instance;
        }

        /// <summary>Read-only snapshot for debug HUDs and adaptive-quality heuristics.</summary>
        public struct PoolStats
        {
            public int PrefabId;
            public string PrefabName;
            public int CreatedCount;
            public int ActiveCount;
            public int FreeCount;
            public int HardCap;
            public int TotalRents;
        }

        // ------------------------------------------------------------------ static state

        public static ObjectPoolManager Instance { get; private set; }
        public static bool HasInstance => Instance != null;

        private static readonly List<Pool> s_poolScratch = new List<Pool>(64);
        private static readonly List<GameObject> s_gameObjectScratch = new List<GameObject>(256);
        private static readonly List<int> s_intScratch = new List<int>(256);
        private static readonly List<IPoolable> s_poolableScratch = new List<IPoolable>(16);

        // ------------------------------------------------------------------ inspector

        [Header("Database")]
        [Tooltip("Designer-authored list of pools created automatically at boot.")]
        [SerializeField] private ObjectPoolDatabase _database;

        [Tooltip("Instantiate all database pools during Awake, before any gameplay script runs.")]
        [SerializeField] private bool _prewarmOnAwake = true;

        [Header("Defaults for pools registered from code")]
        [SerializeField] private int _defaultPrewarmCount = 8;
        [SerializeField] private int _defaultHardCap = 256;
        [SerializeField] private int _defaultExpandBatch = 8;
        [SerializeField] private bool _defaultAllowExpansion = true;

        // ------------------------------------------------------------------ instance state

        private Transform _root;
        private readonly Dictionary<int, Pool> _poolsByPrefabId = new Dictionary<int, Pool>(128);
        private readonly Dictionary<int, InstanceRecord> _recordsByInstanceId = new Dictionary<int, InstanceRecord>(2048);
        private readonly List<DelayedReturn> _delayedReturns = new List<DelayedReturn>(64);

        // ------------------------------------------------------------------ unity lifecycle

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;

            if (transform.parent == null) DontDestroyOnLoad(gameObject);

            _root = transform;
            SceneManager.sceneUnloaded += OnSceneUnloaded;

            if (_prewarmOnAwake) PrewarmAll();
        }

        private void OnDestroy()
        {
            if (Instance != this) return;

            SceneManager.sceneUnloaded -= OnSceneUnloaded;
            Instance = null;
        }

        private void Update()
        {
            ProcessDelayedReturns();
        }

        private void OnSceneUnloaded(Scene unloadedScene)
        {
            PurgeDestroyedRecords();
        }

        // ------------------------------------------------------------------ registration

        /// <summary>
        /// Registers (and optionally pre-warms) a pool for a prefab from code — used for
        /// dynamically-authored content such as skidmark segments or mission-spawned FX.
        /// Returns the prefab instance id used as the pool key, or 0 on failure.
        /// </summary>
        public int RegisterPool(GameObject prefab, int prewarmCount = -1, int hardCap = -1,
            int expandBatch = -1, bool allowExpansion = true)
        {
            if (prefab == null)
            {
                Debug.LogError("[ObjectPool] RegisterPool called with a null prefab.");
                return 0;
            }

            Pool pool = RegisterPoolInternal(prefab, prewarmCount, hardCap, expandBatch, allowExpansion);
            if (pool.PrewarmCount > 0) PrewarmPool(pool);
            return pool.PrefabId;
        }

        /// <summary>Instantiates every database pool. Called from Awake when _prewarmOnAwake is set.</summary>
        public void PrewarmAll()
        {
            if (_database == null) return;

            int entryCount = _database.EntryCount;
            for (int i = 0; i < entryCount; i++)
            {
                ObjectPoolDatabase.PoolEntry entry = _database.GetEntry(i);
                if (entry == null || entry.Prefab == null)
                {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
                    Debug.LogWarning($"[ObjectPool] Database entry {i} has no prefab assigned; skipped.", _database);
#endif
                    continue;
                }

                Pool pool = RegisterPoolInternal(entry.Prefab, entry.PrewarmCount, entry.HardCap,
                    entry.ExpandBatch, entry.AllowExpansion);
                PrewarmPool(pool);
            }
        }

        private Pool RegisterPoolInternal(GameObject prefab, int prewarmCount, int hardCap,
            int expandBatch, bool allowExpansion)
        {
            int prefabId = prefab.GetInstanceID();
            if (_poolsByPrefabId.TryGetValue(prefabId, out Pool existing)) return existing;

            if (prewarmCount < 0) prewarmCount = _defaultPrewarmCount;
            if (hardCap < 0) hardCap = _defaultHardCap;
            if (expandBatch < 1) expandBatch = _defaultExpandBatch;
            if (prewarmCount > hardCap) prewarmCount = hardCap;

            GameObject container = new GameObject(prefab.name + "_Pool");
            container.transform.SetParent(_root, false);

            Pool pool = new Pool
            {
                Prefab = prefab,
                PrefabId = prefabId,
                Container = container.transform,
                PrewarmCount = prewarmCount,
                HardCap = hardCap,
                ExpandBatch = expandBatch,
                AllowExpansion = allowExpansion,
                DefaultLocalScale = prefab.transform.localScale
            };

            _poolsByPrefabId.Add(prefabId, pool);
            return pool;
        }

        private Pool GetOrCreatePool(GameObject prefab)
        {
            int prefabId = prefab.GetInstanceID();
            if (_poolsByPrefabId.TryGetValue(prefabId, out Pool existing)) return existing;

#if UNITY_EDITOR || DEVELOPMENT_BUILD
            if (prefab.scene.IsValid())
            {
                Debug.LogError($"[ObjectPool] '{prefab.name}' is a scene object, not a project prefab asset. It cannot be pooled.", prefab);
                return null;
            }
#endif
            return RegisterPoolInternal(prefab, _defaultPrewarmCount, _defaultHardCap,
                _defaultExpandBatch, _defaultAllowExpansion);
        }

        private void PrewarmPool(Pool pool)
        {
            int target = Mathf.Min(pool.PrewarmCount, pool.HardCap);
            for (int i = pool.CreatedCount; i < target; i++) CreateInstance(pool);
        }

        // ------------------------------------------------------------------ rent

        /// <summary>Rents a pooled instance at a world position/rotation and activates it. Returns null at hard cap.</summary>
        public GameObject Rent(GameObject prefab, Vector3 position, Quaternion rotation)
        {
            GameObject instance = RentInactive(prefab);
            if (instance == null) return null;

            instance.transform.SetPositionAndRotation(position, rotation);
            Activate(instance);
            return instance;
        }

        /// <summary>Rents and parents. The instance ALWAYS ends at the requested world position/rotation.</summary>
        public GameObject Rent(GameObject prefab, Vector3 position, Quaternion rotation,
            Transform parent, bool worldPositionStays = true)
        {
            GameObject instance = RentInactive(prefab);
            if (instance == null) return null;

            Transform instanceTransform = instance.transform;
            if (parent != null) instanceTransform.SetParent(parent, worldPositionStays);
            instanceTransform.SetPositionAndRotation(position, rotation);
            Activate(instance);
            return instance;
        }

        /// <summary>Typed rent — passes the component directly so callers keep zero GameObject lookups.</summary>
        public T Rent<T>(T prefab, Vector3 position, Quaternion rotation) where T : Component
        {
            if (prefab == null)
            {
                Debug.LogError("[ObjectPool] Rent<T> called with a null prefab component.");
                return null;
            }

            GameObject instance = Rent(prefab.gameObject, position, rotation);
            return instance != null ? instance.GetComponent<T>() : null;
        }

        /// <summary>
        /// Rents WITHOUT activating or repositioning — for callers that must configure the
        /// object before it becomes visible. Follow with SetPositionAndRotation + Activate().
        /// </summary>
        public GameObject RentInactive(GameObject prefab)
        {
            if (prefab == null)
            {
                Debug.LogError("[ObjectPool] Rent called with a null prefab.");
                return null;
            }

            Pool pool = GetOrCreatePool(prefab);
            if (pool == null) return null;

            int instanceId;
            if (!TryPopFreeInstance(pool, out instanceId))
            {
                if (pool.CreatedCount >= pool.HardCap)
                {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
                    Debug.LogWarning($"[ObjectPool] Pool '{pool.Prefab.name}' reached its hard cap of {pool.HardCap}. Rent denied.", pool.Container != null ? pool.Container.gameObject : null);
#endif
                    return null;
                }

                if (!pool.AllowExpansion)
                {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
                    Debug.LogWarning($"[ObjectPool] Pool '{pool.Prefab.name}' exhausted ({pool.CreatedCount} instances) and expansion is disabled.", pool.Container != null ? pool.Container.gameObject : null);
#endif
                    return null;
                }

                int expansionBatch = Mathf.Min(pool.ExpandBatch, pool.HardCap - pool.CreatedCount);
                for (int i = 1; i < expansionBatch; i++) CreateInstance(pool);
                CreateInstance(pool);

                if (!TryPopFreeInstance(pool, out instanceId)) return null;
            }

            InstanceRecord record = _recordsByInstanceId[instanceId];
            record.Active = true;
            _recordsByInstanceId[instanceId] = record;

            pool.ActiveCount++;
            pool.TotalRents++;
            return record.Instance;
        }

        /// <summary>Enables a rented instance and fires IPoolable.OnRentFromPool across its hierarchy.</summary>
        public void Activate(GameObject rentedInstance)
        {
            if (rentedInstance == null) return;

            int instanceId = rentedInstance.GetInstanceID();
            if (!_recordsByInstanceId.TryGetValue(instanceId, out InstanceRecord record))
            {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
                Debug.LogError($"[ObjectPool] Activate called on '{rentedInstance.name}' which was not created by the pool.", rentedInstance);
#endif
                return;
            }

            rentedInstance.SetActive(true);

            IPoolable[] callbacks = record.Callbacks;
            for (int i = 0; i < callbacks.Length; i++) callbacks[i].OnRentFromPool();
        }

        // ------------------------------------------------------------------ return

        /// <summary>
        /// Returns an instance to its pool: fires IPoolable.OnReturnToPool, deactivates,
        /// reparents under the pool container, resets local transform, pushes to the free stack.
        /// </summary>
        public void Return(GameObject instance)
        {
            if (instance == null) return;

            int instanceId = instance.GetInstanceID();
            if (!_recordsByInstanceId.TryGetValue(instanceId, out InstanceRecord record))
            {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
                Debug.LogError($"[ObjectPool] '{instance.name}' was never created by the pool; destroying it to prevent a leak. Route ALL dynamic objects through ObjectPoolManager.", instance);
#endif
                Destroy(instance);
                return;
            }

            if (!record.Active)
            {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
                Debug.LogWarning($"[ObjectPool] '{instance.name}' returned while already inactive; duplicate return ignored.", instance);
#endif
                return;
            }

            record.Active = false;
            _recordsByInstanceId[instanceId] = record;

            Pool pool = record.Pool;
            pool.ActiveCount--;

            IPoolable[] callbacks = record.Callbacks;
            for (int i = 0; i < callbacks.Length; i++) callbacks[i].OnReturnToPool();

            instance.SetActive(false);

            Transform instanceTransform = instance.transform;
            instanceTransform.SetParent(pool.Container, false);
            instanceTransform.localPosition = Vector3.zero;
            instanceTransform.localRotation = Quaternion.identity;
            instanceTransform.localScale = pool.DefaultLocalScale;

            pool.FreeInstanceIds.Push(instanceId);
        }

        /// <summary>Schedules a return N seconds from now. Uses scaled time (freezes during pause, matching gameplay FX).</summary>
        public void ReturnDelayed(GameObject instance, float delaySeconds)
        {
            if (instance == null) return;

            _delayedReturns.Add(new DelayedReturn
            {
                ReturnAtTime = Time.time + (delaySeconds > 0f ? delaySeconds : 0f),
                Instance = instance
            });
        }

        private void ProcessDelayedReturns()
        {
            List<DelayedReturn> returns = _delayedReturns;
            if (returns.Count == 0) return;

            float now = Time.time;
            for (int i = returns.Count - 1; i >= 0; i--)
            {
                if (returns[i].ReturnAtTime > now) continue;

                GameObject instance = returns[i].Instance;

                int lastIndex = returns.Count - 1;
                returns[i] = returns[lastIndex];
                returns.RemoveAt(lastIndex);

                Return(instance);
            }
        }

        // ------------------------------------------------------------------ teardown & maintenance

        /// <summary>Destroys every free instance of one pool. Active instances are optionally returned first.</summary>
        public void ClearPool(GameObject prefab, bool destroyActiveInstances = false)
        {
            if (prefab == null) return;
            if (!_poolsByPrefabId.TryGetValue(prefab.GetInstanceID(), out Pool pool)) return;

            ClearPoolInternal(pool, destroyActiveInstances);
        }

        /// <summary>Full reset — used on save reload or memory-pressure trim downs.</summary>
        public void ClearAllPools(bool destroyActiveInstances = false)
        {
            if (_poolsByPrefabId.Count == 0) return;

            s_poolScratch.Clear();
            foreach (Pool pool in _poolsByPrefabId.Values) s_poolScratch.Add(pool);

            for (int i = 0; i < s_poolScratch.Count; i++) ClearPoolInternal(s_poolScratch[i], destroyActiveInstances);
            s_poolScratch.Clear();
        }

        private void ClearPoolInternal(Pool pool, bool destroyActiveInstances)
        {
            if (destroyActiveInstances)
            {
                s_gameObjectScratch.Clear();
                foreach (KeyValuePair<int, InstanceRecord> kvp in _recordsByInstanceId)
                {
                    if (kvp.Value.Pool == pool && kvp.Value.Active && kvp.Value.Instance != null)
                    {
                        s_gameObjectScratch.Add(kvp.Value.Instance);
                    }
                }

                for (int i = 0; i < s_gameObjectScratch.Count; i++) Return(s_gameObjectScratch[i]);
                s_gameObjectScratch.Clear();
            }

            while (pool.FreeInstanceIds.Count > 0)
            {
                int instanceId = pool.FreeInstanceIds.Pop();
                if (_recordsByInstanceId.TryGetValue(instanceId, out InstanceRecord record))
                {
                    _recordsByInstanceId.Remove(instanceId);
                    if (record.Instance != null) Destroy(record.Instance);
                }
                pool.CreatedCount--;
            }
        }

        /// <summary>
        /// Drops records whose instances were destroyed externally (scene unloads, user code).
        /// Called automatically on every scene unload; safe to call manually at any time.
        /// </summary>
        public void PurgeDestroyedRecords()
        {
            bool anyRemoved = false;

            s_intScratch.Clear();
            foreach (KeyValuePair<int, InstanceRecord> kvp in _recordsByInstanceId)
            {
                if (kvp.Value.Instance == null) s_intScratch.Add(kvp.Key);
            }

            for (int i = 0; i < s_intScratch.Count; i++)
            {
                int instanceId = s_intScratch[i];
                InstanceRecord record = _recordsByInstanceId[instanceId];
                if (record.Active) record.Pool.ActiveCount--;
                _recordsByInstanceId.Remove(instanceId);
                anyRemoved = true;
            }
            s_intScratch.Clear();

            if (anyRemoved) RebuildFreeStacks();
        }

        /// <summary>Rebuilds every free stack from the record table, healing any structural corruption.</summary>
        private void RebuildFreeStacks()
        {
            foreach (Pool pool in _poolsByPrefabId.Values) pool.FreeInstanceIds.Clear();

            foreach (KeyValuePair<int, InstanceRecord> kvp in _recordsByInstanceId)
            {
                InstanceRecord record = kvp.Value;
                if (!record.Active && record.Instance != null) record.Pool.FreeInstanceIds.Push(kvp.Key);
            }
        }

        // ------------------------------------------------------------------ queries & diagnostics

        public bool IsPooled(GameObject instance)
        {
            if (instance == null) return false;
            return _recordsByInstanceId.ContainsKey(instance.GetInstanceID());
        }

        public bool IsInstanceActive(GameObject instance)
        {
            if (instance == null) return false;
            return _recordsByInstanceId.TryGetValue(instance.GetInstanceID(), out InstanceRecord record) && record.Active;
        }

        /// <summary>Total active pooled objects across all pools (perf HUD / adaptive quality input).</summary>
        public int GetActiveInstanceCount()
        {
            int total = 0;
            foreach (Pool pool in _poolsByPrefabId.Values) total += pool.ActiveCount;
            return total;
        }

        public int PoolCount => _poolsByPrefabId.Count;

        public bool TryGetPoolStats(GameObject prefab, out PoolStats stats)
        {
            if (prefab != null && _poolsByPrefabId.TryGetValue(prefab.GetInstanceID(), out Pool pool))
            {
                stats = new PoolStats
                {
                    PrefabId = pool.PrefabId,
                    PrefabName = pool.Prefab.name,
                    CreatedCount = pool.CreatedCount,
                    ActiveCount = pool.ActiveCount,
                    FreeCount = pool.FreeInstanceIds.Count,
                    HardCap = pool.HardCap,
                    TotalRents = pool.TotalRents
                };
                return true;
            }

            stats = default(PoolStats);
            return false;
        }

        /// <summary>Fills a caller-owned list with snapshots of every pool — zero alloc per item beyond list growth.</summary>
        public void GetAllPoolStats(List<PoolStats> results)
        {
            if (results == null) return;
            results.Clear();

            foreach (Pool pool in _poolsByPrefabId.Values)
            {
                results.Add(new PoolStats
                {
                    PrefabId = pool.PrefabId,
                    PrefabName = pool.Prefab.name,
                    CreatedCount = pool.CreatedCount,
                    ActiveCount = pool.ActiveCount,
                    FreeCount = pool.FreeInstanceIds.Count,
                    HardCap = pool.HardCap,
                    TotalRents = pool.TotalRents
                });
            }
        }

        // ------------------------------------------------------------------ internals

        private GameObject CreateInstance(Pool pool)
        {
            GameObject instance = Object.Instantiate(pool.Prefab);
            instance.name = $"{pool.Prefab.name}_{pool.CreatedCount:000}";
            pool.CreatedCount++;

            int instanceId = instance.GetInstanceID();
            _recordsByInstanceId[instanceId] = new InstanceRecord
            {
                Pool = pool,
                Instance = instance,
                Callbacks = CollectCallbacks(instance),
                Active = false
            };

            Transform instanceTransform = instance.transform;
            instanceTransform.SetParent(pool.Container, false);
            instanceTransform.localPosition = Vector3.zero;
            instanceTransform.localRotation = Quaternion.identity;
            instanceTransform.localScale = pool.DefaultLocalScale;
            instance.SetActive(false);

            pool.FreeInstanceIds.Push(instanceId);
            return instance;
        }

        private static IPoolable[] CollectCallbacks(GameObject instance)
        {
            s_poolableScratch.Clear();
            instance.GetComponentsInChildren(true, s_poolableScratch);
            IPoolable[] callbacks = s_poolableScratch.ToArray();
            s_poolableScratch.Clear();
            return callbacks;
        }

        private bool TryPopFreeInstance(Pool pool, out int instanceId)
        {
            instanceId = 0;

            while (pool.FreeInstanceIds.Count > 0)
            {
                int candidateId = pool.FreeInstanceIds.Pop();

                if (!_recordsByInstanceId.TryGetValue(candidateId, out InstanceRecord record) || record.Instance == null)
                {
                    _recordsByInstanceId.Remove(candidateId);
                    pool.CreatedCount--;
                    continue;
                }

                if (record.Active)
                {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
                    Debug.LogWarning($"[ObjectPool] Free stack of '{pool.Prefab.name}' contained the active instance '{record.Instance.name}'; rebuilding free stacks.", record.Instance);
#endif
                    RebuildFreeStacks();
                    return false;
                }

                instanceId = candidateId;
                return true;
            }

            return false;
        }

#if UNITY_EDITOR
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStaticsForEnterPlayMode()
        {
            Instance = null;
        }
#endif
    }
}
