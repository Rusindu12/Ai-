# APEX CITY — Open-World Action-Adventure (Unity / Android)

A GTA-style open-world action-adventure game built for mobile (Android APK) in Unity 2022.3 LTS, engineered from the ground up around **zero-GC gameplay loops, aggressive object pooling, and distance-based LOD** to hold 60 FPS on mid-range Snapdragon hardware.

---

## Build Order & Module Tracker

| # | Module | Status |
|---|--------|--------|
| 0 | **Core Engine Foundation** — GameManager, GameEvents, ObjectPoolManager, Core Interfaces | ✅ **DELIVERED** |
| 1 | Core Engine & Player Architecture — third-person controller, IK foot placement, touch input, mobile camera | ⏳ Awaiting command |
| 2 | Advanced Vehicle Dynamics — custom physics, entry/exit, damage & deformation, touch controls | ⏳ |
| 3 | Traffic & Pedestrian Crowd AI — pooling, waypoint traffic, state-machine peds, LOD/culling | ⏳ |
| 4 | Weapon, Shooting & Combat — inventory wheel, gunplay, auto-aim, hit reactions | ⏳ |
| 5 | Police & Wanted Level — 5-star system, pursuit/search AI, roadblocks, SWAT, helicopters | ⏳ |
| 6 | Open-World Streaming & APK Optimization — chunk streaming, occlusion, save/load, HUD/minimap | ⏳ |

---

## Module 0 — Core Engine Foundation (this drop)

```
Assets/Scripts/Core/
├── OpenWorld.Core.asmdef        Assembly definition (compilation isolation, faster iterations)
├── CoreInterfaces.cs            IGameModule, IPoolable, IDamageable, DamageInfo, enums, event marker
├── GameEvents.cs                Static generic zero-GC pub/sub event bus (struct payloads, 'in' params)
├── GameEventDefinitions.cs      Cross-module event contracts (lifecycle, combat, vehicles, wanted, save)
├── GameManager.cs               Phase machine, module registry + unified tick pump, world clock,
│                                time-scale authority, async scene loading, Android platform defaults
├── ObjectPoolManager.cs         Prefab-keyed pool engine: pre-warm, hard caps, burst expansion,
│                                delayed returns, corruption self-healing, stats API
├── ObjectPoolDatabase.cs        Designer-authored pool manifest (ScriptableObject)
├── PoolAutoReturn.cs            Lifetime-based auto-return for casings/decals/debris
└── PoolParticleAutoReturn.cs    Particle-alive-based auto-return for VFX prefabs

Docs/
└── Module0_CoreSetup.md         Scene wiring guide + usage patterns + performance budgets
```

## Architectural Pillars

1. **One MonoBehaviour tick pump.** All manager-level systems implement `IGameModule` and are ticked from `GameManager`'s single `Update`/`FixedUpdate`/`LateUpdate` — no per-system MonoBehaviour overhead, deterministic order via `InitOrder`.
2. **Zero-GC events.** `GameEvents<TEvent>` publishes struct payloads by `in` through custom delegates — no boxing, no closures, no dictionary dispatch on the hot path.
3. **Everything pooled.** Cars, peds, bullets, FX, audio sources, skidmarks — all rented from `ObjectPoolManager`. Instantiation spikes are confined to boot pre-warm.
4. **Contract-first seams.** `DamageInfo`, `IGameEvent` payloads and event definitions are locked now so Modules 1–6 interoperate without rewrites.

## Requirements

- Unity **2022.3 LTS** (or newer 2022.3.x), Android Build Support + OpenJDK + Android SDK/NDK
- IL2CPP, ARM64, target frame rate 60 (set automatically by `GameManager`)

## Getting Started

1. Open the project in Unity (the repo is a valid Unity project root; missing settings are regenerated with defaults on first open).
2. In your boot scene, create two empty GameObjects: `GameManager` (add `GameManager` component) and `ObjectPool` (add `ObjectPoolManager` component, assign a created Object Pool Database asset).
3. Follow `Docs/Module0_CoreSetup.md` for the full wiring and usage patterns.
