// =====================================================================================
//  Project:   APEX CITY — Open-World Action-Adventure (GTA-style, Mobile/Android)
//  Module:    0 — Core Engine Foundation
//  File:      GameEventDefinitions.cs
//  Desc:      The global event contract sheet. Each struct is a point-to-point decoupling
//             seam between modules: Module 4 (weapons) publishes WeaponFiredEvent without
//             knowing Module 5 (police) consumes it for the sound-detection matrix, etc.
//             ALL payloads are structs → publishing is allocation-free.
//             String fields must receive cached/constant strings — never per-call concat.
// =====================================================================================

using UnityEngine;

namespace OpenWorld.Core
{
    // ------------------------------------------------------------------ lifecycle / flow

    /// <summary>Published by GameManager whenever the high-level game phase changes.</summary>
    public struct GamePhaseChangedEvent : IGameEvent
    {
        public GameManager.GamePhase Previous;
        public GameManager.GamePhase Current;
    }

    /// <summary>Published when Android pauses/resumes the app (home button, incoming call).</summary>
    public struct ApplicationPauseEvent : IGameEvent
    {
        public bool IsPaused;
    }

    /// <summary>Published when an async single-mode scene load begins.</summary>
    public struct SceneLoadStartedEvent : IGameEvent
    {
        public string SceneName;
    }

    /// <summary>Throttled progress (published at most every ~2%) for loading-screen UI.</summary>
    public struct SceneLoadProgressEvent : IGameEvent
    {
        public string SceneName;
        public float Progress01;
    }

    /// <summary>Published when the async scene load completes activation.</summary>
    public struct SceneLoadCompletedEvent : IGameEvent
    {
        public string SceneName;
        public float ElapsedSeconds;
    }

    // ------------------------------------------------------------------ player

    /// <summary>Published when the player pawn is bound to the world (spawn or vehicle swap of control).</summary>
    public struct PlayerSpawnedEvent : IGameEvent
    {
        public GameObject Player;
    }

    /// <summary>Published when the player pawn is unbound (death cleanup, level teardown).</summary>
    public struct PlayerDespawnedEvent : IGameEvent
    {
        public GameObject Player;
    }

    /// <summary>Published after the player survives a damage application (HUD flash, camera shake).</summary>
    public struct PlayerDamagedEvent : IGameEvent
    {
        public DamageInfo Damage;
        public float RemainingHealth;
    }

    /// <summary>Published exactly once when player health reaches zero (wasted screen, Module 5 decay).</summary>
    public struct PlayerDiedEvent : IGameEvent
    {
        public DamageInfo FinalDamage;
    }

    // ------------------------------------------------------------------ combat

    /// <summary>Published for any damaged IDamageable (hit markers, blood VFX, stat tracking).</summary>
    public struct EntityDamagedEvent : IGameEvent
    {
        public int TargetInstanceId;
        public GameObject Target;
        public float Amount;
        public EBodyPart HitPart;
        public EDamageType Type;
    }

    /// <summary>Published exactly once per entity death (ragdoll trigger, wanted escalation, mission hooks).</summary>
    public struct EntityKilledEvent : IGameEvent
    {
        public GameObject Victim;
        public GameObject Killer;
        public DamageInfo FinalDamage;
    }

    /// <summary>
    /// Published on every trigger pull. Consumed by Module 5 (sound detection), Module 3
    /// (pedestrian flee) and audio/VFX systems. MuzzlePosition is the world-space origin.
    /// </summary>
    public struct WeaponFiredEvent : IGameEvent
    {
        public int WeaponId;
        public Vector3 MuzzlePosition;
        public Vector3 Direction;
        public bool IsSuppressed;
    }

    /// <summary>Published when any explosion detonates (grenades, vehicles, barrels). Drives AoE damage queries.</summary>
    public struct ExplosionOccurredEvent : IGameEvent
    {
        public Vector3 Position;
        public float Radius;
        public float Force;
        public GameObject Source;
    }

    // ------------------------------------------------------------------ vehicles

    /// <summary>Published when an occupant takes a seat (door anims, IK steering hands, camera transition).</summary>
    public struct VehicleEnteredEvent : IGameEvent
    {
        public GameObject Vehicle;
        public GameObject Occupant;
        public int SeatIndex;
    }

    /// <summary>Published when an occupant leaves a seat.</summary>
    public struct VehicleExitedEvent : IGameEvent
    {
        public GameObject Vehicle;
        public GameObject Occupant;
    }

    /// <summary>Published once per vehicle destruction (explosion VFX spawn, traffic slot release).</summary>
    public struct VehicleDestroyedEvent : IGameEvent
    {
        public GameObject Vehicle;
        public Vector3 Position;
    }

    // ------------------------------------------------------------------ wanted / crime

    /// <summary>Published on wanted-level delta (0-5). Drives spawn tables, music stingers, HUD stars.</summary>
    public struct WantedLevelChangedEvent : IGameEvent
    {
        public int PreviousLevel;
        public int NewLevel;
    }

    /// <summary>
    /// Published by crime witnesses (peds, cops). Severity maps to wanted heat contribution.
    /// CrimeId indexes the crime definition table implemented in Module 5.
    /// </summary>
    public struct CrimeCommittedEvent : IGameEvent
    {
        public Vector3 Position;
        public GameObject Perpetrator;
        public int CrimeId;
        public int Severity;
    }

    // ------------------------------------------------------------------ world simulation

    /// <summary>Published when the world clock wraps into a new hour (traffic density, shop hours, lighting).</summary>
    public struct WorldHourChangedEvent : IGameEvent
    {
        public int DayCount;
        public int Hour;
    }

    // ------------------------------------------------------------------ UI / persistence

    /// <summary>Queued HUD notification request (top-left feed). Message must be a cached string.</summary>
    public struct NotificationRequestedEvent : IGameEvent
    {
        public string Message;
        public float DurationSeconds;
        public int Priority;
    }

    /// <summary>Published by GameManager.RequestSave; the save orchestrator module subscribes.</summary>
    public struct SaveRequestedEvent : IGameEvent
    {
        public int SlotIndex;
    }

    /// <summary>Result of a save operation (confirmation toast, cloud-sync queue).</summary>
    public struct SaveCompletedEvent : IGameEvent
    {
        public int SlotIndex;
        public bool Success;
        public string Error;
    }

    /// <summary>Result of a load operation (fade-in, restore callbacks).</summary>
    public struct LoadCompletedEvent : IGameEvent
    {
        public int SlotIndex;
        public bool Success;
        public string Error;
    }
}
