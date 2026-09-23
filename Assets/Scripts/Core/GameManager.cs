// =====================================================================================
//  Project:   APEX CITY — Open-World Action-Adventure (GTA-style, Mobile/Android)
//  Module:    0 — Core Engine Foundation
//  File:      GameManager.cs
//  Desc:      The single authoritative orchestrator of the game's meta-state:
//               • Game phase state machine (Boot → Menu → Loading → Playing → …)
//               • Module service registry (IGameModule) with a unified, sorted tick pump
//               • Time-scale authority (pause / slow-motion with smooth or snap blending)
//               • World clock (game-day simulation driving traffic density & lighting)
//               • Async scene loading with throttled progress events
//               • Android platform defaults (frame-rate cap, vSync, sleep timeout)
//  Perf:      Per-frame work is allocation-free. Modules are stored in flat arrays and
//             ticked with cached-length for loops; arrays are rebuilt ONLY at
//             registration time. All events are structs.
//  Setup:     Place on an empty " GameManager " GameObject in the boot scene. It runs
//             first (ExecutionOrder -32000) and survives scene changes.
// =====================================================================================

using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace OpenWorld.Core
{
    [DefaultExecutionOrder(-32000)]
    public sealed class GameManager : MonoBehaviour
    {
        // ------------------------------------------------------------------ types

        /// <summary>High-level application phases. Transitions are validated by IsTransitionValid.</summary>
        public enum GamePhase : byte
        {
            Boot = 0,
            MainMenu = 1,
            WorldLoading = 2,
            Playing = 3,
            Paused = 4,
            Cinematic = 5,
            PlayerDead = 6,
            ShuttingDown = 7
        }

        // ------------------------------------------------------------------ constants

        public const int DefaultMobileTargetFrameRate = 60;
        private const float SecondsPerGameDay = 1440f;
        private const float FpsWindowSeconds = 0.5f;
        private const float SceneProgressPublishStep = 0.02f;

        // ------------------------------------------------------------------ static state

        private static GameManager _instance;
        private static readonly Dictionary<Type, IGameModule> s_modules = new Dictionary<Type, IGameModule>(32);
        private static readonly List<IGameModule> s_moduleScratch = new List<IGameModule>(32);
        private static readonly Comparison<IGameModule> s_initOrderComparison = CompareInitOrder;

        // ------------------------------------------------------------------ inspector

        [Header("Boot")]
        [SerializeField] private bool _applyMobileDefaults = true;
        [Range(24, 120)]
        [SerializeField] private int _targetFrameRate = DefaultMobileTargetFrameRate;
        [SerializeField] private bool _autoPauseOnFocusLost = true;
        [SerializeField] private bool _persistAcrossScenes = true;

        [Header("World Clock")]
        [Tooltip("Game minutes that elapse per real second. 1.0 = a full day in 24 real minutes.")]
        [SerializeField] private float _gameMinutesPerRealSecond = 1f;
        [SerializeField] private float _startHour = 9f;

        [Header("Time")]
        [Tooltip("Time-scale units per real second used when blending slow-motion in/out.")]
        [SerializeField] private float _timeScaleLerpSpeed = 4f;

        // ------------------------------------------------------------------ instance state

        private GamePhase _phase = GamePhase.Boot;
        private GameObject _player;

        private IGameModule[] _updateModules = Array.Empty<IGameModule>();
        private IGameModule[] _fixedUpdateModules = Array.Empty<IGameModule>();
        private IGameModule[] _lateUpdateModules = Array.Empty<IGameModule>();

        private AsyncOperation _sceneLoadOperation;
        private string _loadingSceneName;
        private GamePhase _phaseAfterSceneLoad = GamePhase.Playing;
        private float _sceneLoadStartRealtime;
        private float _lastPublishedLoadProgress = -1f;

        private float _gameMinutes;
        private int _dayCount;
        private int _lastPublishedHour = -1;

        private float _timeScale = 1f;
        private float _targetTimeScale = 1f;
        private bool _snapTimeScale = true;

        private int _fpsFrameAccumulator;
        private float _fpsWindowElapsed;
        private float _smoothedFrameRate = DefaultMobileTargetFrameRate;

        // ------------------------------------------------------------------ static accessors

        public static GameManager Instance => _instance;
        public static bool HasInstance => _instance != null;

        /// <summary>Current authoritative phase. Safe to read from anywhere (returns Boot if no instance).</summary>
        public static GamePhase Phase => _instance != null ? _instance._phase : GamePhase.Boot;

        public static bool IsPlaying => Phase == GamePhase.Playing;
        public static bool IsPaused => Phase == GamePhase.Paused;

        /// <summary>True only while normal gameplay input should be processed.</summary>
        public static bool IsInputEnabled => Phase == GamePhase.Playing;

        /// <summary>True while the world should keep simulating (playing or scripted cinematics).</summary>
        public static bool IsWorldSimulationActive
        {
            get
            {
                GamePhase phase = Phase;
                return phase == GamePhase.Playing || phase == GamePhase.Cinematic;
            }
        }

        public static bool IsLoadingScene => _instance != null && _instance._sceneLoadOperation != null;

        /// <summary>Rolling average FPS sampled over a 0.5s unscaled window (perf HUD, adaptive quality).</summary>
        public static float SmoothedFrameRate => _instance != null ? _instance._smoothedFrameRate : 0f;

        public static GameObject Player => _instance != null ? _instance._player : null;

        public static Transform PlayerTransform
        {
            get { return _instance != null && _instance._player != null ? _instance._player.transform : null; }
        }

        /// <summary>Continuous world hour in [0, 24). Sample directly for sun angles and NPC schedules.</summary>
        public static float WorldHour => _instance != null ? _instance._gameMinutes * (1f / 60f) : 0f;

        public static int WorldDay => _instance != null ? _instance._dayCount : 0;

        /// <summary>World time normalized to [0, 1) across a full day.</summary>
        public static float WorldTimeNormalized
        {
            get { return _instance != null ? _instance._gameMinutes * (1f / SecondsPerGameDay) : 0f; }
        }

        public static float CurrentTimeScale => _instance != null ? _instance._timeScale : Time.timeScale;

        // ------------------------------------------------------------------ instance accessors

        /// <summary>Progress of the active scene load in [0, 1]; 1 when idle. Read by the loading screen.</summary>
        public float SceneLoadProgress01
        {
            get
            {
                AsyncOperation operation = _sceneLoadOperation;
                return operation != null ? operation.progress : 1f;
            }
        }

        // ------------------------------------------------------------------ unity lifecycle

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }

            _instance = this;

            if (_persistAcrossScenes) DontDestroyOnLoad(gameObject);
            if (_applyMobileDefaults) ApplyMobileDefaults();

            _gameMinutes = Mathf.Repeat(_startHour, 24f) * 60f;
            _lastPublishedHour = (int)(_gameMinutes * (1f / 60f));

            Time.timeScale = 1f;

            SceneManager.sceneUnloaded += OnSceneUnloaded;
        }

        private void OnDestroy()
        {
            if (_instance != this) return;

            SceneManager.sceneUnloaded -= OnSceneUnloaded;
            ShutdownAllModules();
            _instance = null;
        }

        /// <summary>Single entry point for all module Update ticks — one MonoBehaviour loop for the entire game.</summary>
        private void Update()
        {
            float unscaledDeltaTime = Time.unscaledDeltaTime;
            float deltaTime = Time.deltaTime;

            TickTimeScale(unscaledDeltaTime);
            TickWorldClock(deltaTime);
            TickSceneLoading();
            TickFrameRate(unscaledDeltaTime);

            IGameModule[] modules = _updateModules;
            for (int i = 0; i < modules.Length; i++) modules[i].ModuleUpdate(deltaTime);
        }

        private void FixedUpdate()
        {
            IGameModule[] modules = _fixedUpdateModules;
            float fixedDeltaTime = Time.fixedDeltaTime;
            for (int i = 0; i < modules.Length; i++) modules[i].ModuleFixedUpdate(fixedDeltaTime);
        }

        private void LateUpdate()
        {
            IGameModule[] modules = _lateUpdateModules;
            float deltaTime = Time.deltaTime;
            for (int i = 0; i < modules.Length; i++) modules[i].ModuleLateUpdate(deltaTime);
        }

        private void OnApplicationPause(bool pauseStatus)
        {
            GameEvents<ApplicationPauseEvent>.Publish(new ApplicationPauseEvent { IsPaused = pauseStatus });

            if (pauseStatus && _autoPauseOnFocusLost && _phase == GamePhase.Playing) SetPaused(true);
        }

        private void OnApplicationFocus(bool hasFocus)
        {
            if (!hasFocus && _autoPauseOnFocusLost && _phase == GamePhase.Playing) SetPaused(true);
        }

        private void OnSceneUnloaded(Scene unloadedScene)
        {
            if (ObjectPoolManager.HasInstance) ObjectPoolManager.Instance.PurgeDestroyedRecords();
        }

        // ------------------------------------------------------------------ platform defaults

        private void ApplyMobileDefaults()
        {
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = Mathf.Clamp(_targetFrameRate, 24, 120);
            Screen.sleepTimeout = SleepTimeout.NeverSleep;
            Application.runInBackground = false;
        }

        // ------------------------------------------------------------------ phase machine

        /// <summary>
        /// Attempts a phase transition. Invalid transitions are refused with an error log so
        /// gameplay code fails loudly during development instead of corrupting state.
        /// </summary>
        public static void SetPhase(GamePhase newPhase)
        {
            GameManager instance = _instance;
            if (instance == null)
            {
                Debug.LogError("[GameManager] SetPhase called without an active GameManager instance.");
                return;
            }

            if (newPhase == instance._phase) return;

            if (!IsTransitionValid(instance._phase, newPhase))
            {
                Debug.LogError($"[GameManager] Invalid phase transition {instance._phase} -> {newPhase}. Request refused.");
                return;
            }

            GamePhase previous = instance._phase;
            instance._phase = newPhase;

            if (newPhase == GamePhase.Paused)
            {
                instance._targetTimeScale = 0f;
                instance._snapTimeScale = true;
                instance._timeScale = 0f;
                Time.timeScale = 0f;
            }
            else if (previous == GamePhase.Paused)
            {
                instance._targetTimeScale = 1f;
                instance._snapTimeScale = true;
                instance._timeScale = 1f;
                Time.timeScale = 1f;
            }

            GameEvents<GamePhaseChangedEvent>.Publish(new GamePhaseChangedEvent
            {
                Previous = previous,
                Current = newPhase
            });
        }

        /// <summary>Toggles the pause overlay phase (only meaningful from Playing).</summary>
        public static void SetPaused(bool paused)
        {
            if (paused)
            {
                if (Phase == GamePhase.Playing) SetPhase(GamePhase.Paused);
            }
            else
            {
                if (Phase == GamePhase.Paused) SetPhase(GamePhase.Playing);
            }
        }

        private static bool IsTransitionValid(GamePhase from, GamePhase to)
        {
            switch (from)
            {
                case GamePhase.Boot:
                    return to == GamePhase.MainMenu || to == GamePhase.WorldLoading || to == GamePhase.ShuttingDown;
                case GamePhase.MainMenu:
                    return to == GamePhase.WorldLoading || to == GamePhase.ShuttingDown;
                case GamePhase.WorldLoading:
                    return to == GamePhase.Playing || to == GamePhase.MainMenu || to == GamePhase.ShuttingDown;
                case GamePhase.Playing:
                    return to == GamePhase.Paused || to == GamePhase.Cinematic || to == GamePhase.PlayerDead
                        || to == GamePhase.WorldLoading || to == GamePhase.MainMenu || to == GamePhase.ShuttingDown;
                case GamePhase.Paused:
                    return to == GamePhase.Playing || to == GamePhase.MainMenu || to == GamePhase.ShuttingDown;
                case GamePhase.Cinematic:
                    return to == GamePhase.Playing || to == GamePhase.Paused || to == GamePhase.PlayerDead
                        || to == GamePhase.WorldLoading || to == GamePhase.MainMenu || to == GamePhase.ShuttingDown;
                case GamePhase.PlayerDead:
                    return to == GamePhase.Playing || to == GamePhase.WorldLoading || to == GamePhase.MainMenu
                        || to == GamePhase.ShuttingDown;
                case GamePhase.ShuttingDown:
                    return false;
                default:
                    return true;
            }
        }

        // ------------------------------------------------------------------ time scale authority

        /// <summary>
        /// Sets the gameplay time scale. Use snapToValue=true for hard cuts (pause, restore);
        /// snapToValue=false smoothly blends — e.g. SetTimeScale(0.3f) for kill-cam slow motion.
        /// </summary>
        public static void SetTimeScale(float scale, bool snapToValue = false)
        {
            GameManager instance = _instance;
            if (instance == null) return;

            instance._targetTimeScale = Mathf.Clamp(scale, 0f, 4f);
            instance._snapTimeScale = snapToValue;

            if (snapToValue)
            {
                instance._timeScale = instance._targetTimeScale;
                Time.timeScale = instance._timeScale;
            }
        }

        public static void ResetTimeScale()
        {
            SetTimeScale(1f, true);
        }

        private void TickTimeScale(float unscaledDeltaTime)
        {
            if (_snapTimeScale)
            {
                if (!Mathf.Approximately(_timeScale, _targetTimeScale))
                {
                    _timeScale = _targetTimeScale;
                    Time.timeScale = _timeScale;
                }
                return;
            }

            if (Mathf.Approximately(_timeScale, _targetTimeScale)) return;

            _timeScale = Mathf.MoveTowards(_timeScale, _targetTimeScale, _timeScaleLerpSpeed * unscaledDeltaTime);
            Time.timeScale = _timeScale;
        }

        // ------------------------------------------------------------------ world clock

        /// <summary>Hard-sets the world clock. Does not advance the day counter.</summary>
        public static void SetWorldTime(float hour)
        {
            GameManager instance = _instance;
            if (instance == null) return;

            instance._gameMinutes = Mathf.Clamp(hour, 0f, 24f) * 60f;
            instance._lastPublishedHour = (int)(instance._gameMinutes * (1f / 60f));
        }

        private void TickWorldClock(float scaledDeltaTime)
        {
            if (_gameMinutesPerRealSecond <= 0f) return;
            if (!IsWorldSimulationActive) return;

            _gameMinutes += scaledDeltaTime * _gameMinutesPerRealSecond;

            if (_gameMinutes >= SecondsPerGameDay)
            {
                _gameMinutes -= SecondsPerGameDay;
                _dayCount++;
            }

            int hour = (int)(_gameMinutes * (1f / 60f));
            if (hour != _lastPublishedHour)
            {
                _lastPublishedHour = hour;
                GameEvents<WorldHourChangedEvent>.Publish(new WorldHourChangedEvent
                {
                    DayCount = _dayCount,
                    Hour = hour
                });
            }
        }

        // ------------------------------------------------------------------ scene streaming (single scenes)

        /// <summary>
        /// Starts an async single-mode scene load. Publishes SceneLoadStarted / Progress /
        /// Completed events and automatically transitions to <paramref name="phaseAfterLoad"/>.
        /// </summary>
        public static void LoadScene(string sceneName, GamePhase phaseAfterLoad = GamePhase.Playing)
        {
            GameManager instance = _instance;
            if (instance == null)
            {
                Debug.LogError("[GameManager] LoadScene called without an active GameManager instance.");
                return;
            }

            if (string.IsNullOrEmpty(sceneName))
            {
                Debug.LogError("[GameManager] LoadScene called with a null or empty scene name.");
                return;
            }

            if (instance._sceneLoadOperation != null)
            {
                Debug.LogWarning("[GameManager] A scene load is already in progress; request ignored.");
                return;
            }

            if (instance._phase == GamePhase.ShuttingDown) return;

            instance._loadingSceneName = sceneName;
            instance._sceneLoadStartRealtime = Time.realtimeSinceStartup;
            instance._lastPublishedLoadProgress = -1f;
            instance._phaseAfterSceneLoad = phaseAfterLoad;
            instance._sceneLoadOperation = SceneManager.LoadSceneAsync(sceneName, LoadSceneMode.Single);

            GameEvents<SceneLoadStartedEvent>.Publish(new SceneLoadStartedEvent { SceneName = sceneName });
            SetPhase(GamePhase.WorldLoading);
        }

        /// <summary>Convenience teardown: resets time scale and returns to the menu scene.</summary>
        public static void QuitToMainMenu(string mainMenuSceneName)
        {
            ResetTimeScale();
            if (!string.IsNullOrEmpty(mainMenuSceneName)) LoadScene(mainMenuSceneName, GamePhase.MainMenu);
            else SetPhase(GamePhase.MainMenu);
        }

        public static void QuitGame()
        {
            if (_instance != null) _instance._phase = GamePhase.ShuttingDown;
            Application.Quit();
#if UNITY_EDITOR
            UnityEditor.EditorApplication.isPlaying = false;
#endif
        }

        private void TickSceneLoading()
        {
            AsyncOperation operation = _sceneLoadOperation;
            if (operation == null) return;

            float progress = operation.progress;
            if (progress - _lastPublishedLoadProgress >= SceneProgressPublishStep)
            {
                _lastPublishedLoadProgress = progress;
                GameEvents<SceneLoadProgressEvent>.Publish(new SceneLoadProgressEvent
                {
                    SceneName = _loadingSceneName,
                    Progress01 = progress
                });
            }

            if (!operation.isDone) return;

            _sceneLoadOperation = null;
            float elapsedSeconds = Time.realtimeSinceStartup - _sceneLoadStartRealtime;

            GameEvents<SceneLoadProgressEvent>.Publish(new SceneLoadProgressEvent
            {
                SceneName = _loadingSceneName,
                Progress01 = 1f
            });
            GameEvents<SceneLoadCompletedEvent>.Publish(new SceneLoadCompletedEvent
            {
                SceneName = _loadingSceneName,
                ElapsedSeconds = elapsedSeconds
            });

            SetPhase(IsTransitionValid(_phase, _phaseAfterSceneLoad) ? _phaseAfterSceneLoad : GamePhase.Playing);
        }

        // ------------------------------------------------------------------ player binding

        /// <summary>Binds (or unbinds with null) the active player pawn and publishes spawn/despawn events.</summary>
        public static void SetPlayer(GameObject player)
        {
            GameManager instance = _instance;
            if (instance == null)
            {
                Debug.LogError("[GameManager] SetPlayer called without an active GameManager instance.");
                return;
            }

            if (ReferenceEquals(instance._player, player)) return;

            instance._player = player;

            if (player != null)
            {
                GameEvents<PlayerSpawnedEvent>.Publish(new PlayerSpawnedEvent { Player = player });
            }
            else
            {
                GameEvents<PlayerDespawnedEvent>.Publish(new PlayerDespawnedEvent { Player = null });
            }
        }

        // ------------------------------------------------------------------ module registry

        /// <summary>
        /// Registers a manager-level system under its concrete type. Called from the module's
        /// own Awake (GameManager is guaranteed to have initialized first via execution order).
        /// The registry key is typeof(T) so lookup is a dictionary hit with zero GC.
        /// </summary>
        public static void RegisterModule<T>(T module) where T : class, IGameModule
        {
            if (module == null) throw new ArgumentNullException(nameof(module));

            Type moduleType = typeof(T);
            if (s_modules.ContainsKey(moduleType))
            {
                Debug.LogError($"[GameManager] Module '{moduleType.Name}' is already registered.");
                return;
            }

            s_modules.Add(moduleType, module);
            if (_instance == null)
            {
                Debug.LogError($"[GameManager] Module '{moduleType.Name}' registered before the GameManager existed. " +
                               "Ensure the GameManager GameObject executes first (execution order -32000). The module will not tick until the next registry rebuild.");
            }
            else
            {
                module.OnRegistered(_instance);
            }
            RebuildTickArrays();

#if UNITY_EDITOR || DEVELOPMENT_BUILD
            Debug.Log($"[GameManager] Module registered: {module.ModuleName} (order {module.InitOrder})");
#endif
        }

        /// <summary>Unregisters and shuts down a module. Safe to call for a type that was never registered.</summary>
        public static void UnregisterModule<T>() where T : class, IGameModule
        {
            Type moduleType = typeof(T);
            if (!s_modules.TryGetValue(moduleType, out IGameModule module)) return;

            s_modules.Remove(moduleType);
            module.OnUnregistered();
            RebuildTickArrays();
        }

        /// <summary>Zero-GC module lookup: if (GameManager.TryGetModule(out TrafficManager tm)) …</summary>
        public static bool TryGetModule<T>(out T module) where T : class, IGameModule
        {
            if (s_modules.TryGetValue(typeof(T), out IGameModule found))
            {
                module = (T)found;
                return true;
            }

            module = null;
            return false;
        }

        /// <summary>Rebuilds the flat tick arrays. Registration-time allocation only — never called per frame.</summary>
        private static void RebuildTickArrays()
        {
            if (_instance == null) return;

            int moduleCount = s_modules.Count;
            List<IGameModule> updateList = new List<IGameModule>(moduleCount);
            List<IGameModule> fixedList = new List<IGameModule>(moduleCount);
            List<IGameModule> lateList = new List<IGameModule>(moduleCount);

            foreach (IGameModule module in s_modules.Values)
            {
                if (module.UpdateEnabled) updateList.Add(module);
                if (module.FixedUpdateEnabled) fixedList.Add(module);
                if (module.LateUpdateEnabled) lateList.Add(module);
            }

            updateList.Sort(s_initOrderComparison);
            fixedList.Sort(s_initOrderComparison);
            lateList.Sort(s_initOrderComparison);

            _instance._updateModules = updateList.ToArray();
            _instance._fixedUpdateModules = fixedList.ToArray();
            _instance._lateUpdateModules = lateList.ToArray();
        }

        private static int CompareInitOrder(IGameModule a, IGameModule b)
        {
            return a.InitOrder.CompareTo(b.InitOrder);
        }

        private static void ShutdownAllModules()
        {
            if (s_modules.Count == 0) return;

            s_moduleScratch.Clear();
            foreach (IGameModule module in s_modules.Values) s_moduleScratch.Add(module);
            s_modules.Clear();

            for (int i = 0; i < s_moduleScratch.Count; i++) s_moduleScratch[i].OnUnregistered();
            s_moduleScratch.Clear();
        }

        // ------------------------------------------------------------------ persistence & misc hooks

        /// <summary>Broadcasts a save request; the save orchestrator (Module 6) performs the IO off the hot path.</summary>
        public static void RequestSave(int slotIndex)
        {
            GameEvents<SaveRequestedEvent>.Publish(new SaveRequestedEvent { SlotIndex = slotIndex });
        }

        private void TickFrameRate(float unscaledDeltaTime)
        {
            _fpsFrameAccumulator++;
            _fpsWindowElapsed += unscaledDeltaTime;

            if (_fpsWindowElapsed >= FpsWindowSeconds)
            {
                _smoothedFrameRate = _fpsFrameAccumulator / _fpsWindowElapsed;
                _fpsFrameAccumulator = 0;
                _fpsWindowElapsed = 0f;
            }
        }

#if UNITY_EDITOR
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStaticsForEnterPlayMode()
        {
            s_modules.Clear();
            _instance = null;
        }
#endif
    }
}
