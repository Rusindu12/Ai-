// =====================================================================================
//  Project:   APEX CITY — Open-World Action-Adventure (GTA-style, Mobile/Android)
//  Module:    0 — Core Engine Foundation
//  File:      CoreInterfaces.cs
//  Desc:      Engine-wide contracts (interfaces, enums, damage payload). Every gameplay
//             module implements or consumes these contracts, which locks the seams
//             between systems early and keeps the architecture decoupled.
//  Notes:     All gameplay payloads are structs passed by 'in' to guarantee zero
//             heap allocation on the hot path.
// =====================================================================================

using System;
using System.IO;
using UnityEngine;

namespace OpenWorld.Core
{
    /// <summary>
    /// Marker contract for zero-garbage event payloads published through
    /// <see cref="GameEvents{TEvent}"/>. Must be implemented by structs only.
    /// </summary>
    public interface IGameEvent
    {
    }

    /// <summary>Body-part classification used for hit-scan resolution and damage multipliers.</summary>
    public enum EBodyPart : byte
    {
        None = 0,
        Head = 1,
        Neck = 2,
        Torso = 3,
        Stomach = 4,
        LeftArm = 5,
        RightArm = 6,
        LeftLeg = 7,
        RightLeg = 8
    }

    /// <summary>Source classification of a damage instance, consumed by reaction/ragdoll/forensics systems.</summary>
    public enum EDamageType : byte
    {
        Bullet = 0,
        Melee = 1,
        Explosion = 2,
        VehicleImpact = 3,
        Fall = 4,
        Fire = 5,
        Drowning = 6,
        Environmental = 7,
        Invalid = 255
    }

    /// <summary>
    /// Immutable damage payload passed by reference through the entire combat pipeline
    /// (weapons → hit resolution → health → wanted system → reactions). Zero GC.
    /// </summary>
    public struct DamageInfo
    {
        public float Amount;
        public EDamageType Type;
        public EBodyPart HitPart;
        public Vector3 HitPoint;
        public Vector3 HitNormal;
        public Vector3 Direction;
        public GameObject Source;
        public int SourceInstanceId;
        public int WeaponId;

        /// <summary>Factory used by weapon, melee, vehicle and world-hazard systems.</summary>
        public static DamageInfo Create(float amount, EDamageType type, EBodyPart hitPart,
            Vector3 hitPoint, Vector3 hitNormal, Vector3 direction, GameObject source, int weaponId = 0)
        {
            DamageInfo info;
            info.Amount = amount;
            info.Type = type;
            info.HitPart = hitPart;
            info.HitPoint = hitPoint;
            info.HitNormal = hitNormal;
            info.Direction = direction;
            info.Source = source;
            info.SourceInstanceId = source != null ? source.GetInstanceID() : 0;
            info.WeaponId = weaponId;
            return info;
        }
    }

    /// <summary>Implemented by anything that can receive damage: player, peds, vehicles, props.</summary>
    public interface IDamageable
    {
        bool IsAlive { get; }
        void ApplyDamage(in DamageInfo info);
    }

    /// <summary>Implemented by entities that can be restored (health kits, repair shops).</summary>
    public interface IHealable
    {
        void ApplyHealing(float amount);
    }

    /// <summary>
    /// Pool lifecycle hooks. Invoked on rent AFTER the object is enabled (so Awake/OnEnable
    /// ran) and on return BEFORE the object is deactivated (so state can be flushed).
    /// </summary>
    public interface IPoolable
    {
        void OnRentFromPool();
        void OnReturnToPool();
    }

    /// <summary>Implemented by doors, pickups, vehicles and shop terminals for the universal interact probe.</summary>
    public interface IInteractable
    {
        bool IsActive { get; }
        float InteractionRadius { get; }
        bool CanInteract(GameObject interactor);
        void Interact(GameObject interactor);
    }

    /// <summary>
    /// Implemented by persistent systems. State is written/read through BinaryWriter/Reader
    /// (Module 6 save pipeline); <paramref name="savedVersion"/> allows forward migration.
    /// </summary>
    public interface ISaveable
    {
        int SaveVersion { get; }
        void WriteState(BinaryWriter writer);
        void ReadState(BinaryReader reader, int savedVersion);
    }

    /// <summary>Implemented by character controllers that can hand the body over to a ragdoll solver.</summary>
    public interface IRagdoll
    {
        bool IsRagdolled { get; }
        void EnterRagdoll(in Vector3 impulse);
        void ExitRagdoll();
    }

    /// <summary>Implemented by valid aim-assist candidates (Module 4 target selection).</summary>
    public interface IAimTarget
    {
        bool IsValidTarget { get; }
        Vector3 AimPoint { get; }
        float TargetWeight { get; }
    }

    /// <summary>
    /// Contract for manager-level systems registered with <see cref="GameManager"/>. Registered
    /// modules are ticked from the GameManager's single Update/FixedUpdate/LateUpdate pump,
    /// eliminating per-system MonoBehaviour overhead and guaranteeing deterministic tick order
    /// via <see cref="InitOrder"/>.
    /// </summary>
    public interface IGameModule
    {
        string ModuleName { get; }
        int InitOrder { get; }
        bool UpdateEnabled { get; }
        bool FixedUpdateEnabled { get; }
        bool LateUpdateEnabled { get; }
        void OnRegistered(GameManager game);
        void ModuleUpdate(float deltaTime);
        void ModuleFixedUpdate(float fixedDeltaTime);
        void ModuleLateUpdate(float deltaTime);
        void OnUnregistered();
    }
}
