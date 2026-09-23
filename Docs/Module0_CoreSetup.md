# Module 0 — Core Engine Foundation: Setup & Usage Guide

## 1. Scene Wiring (Boot Scene)

```
BootScene
├── [GameManager]        ← GameManager component (Execution Order -32000, runs first)
└── [ObjectPool]         ← ObjectPoolManager component (Execution Order -31900)
```

**GameManager** — empty GameObject, add the `GameManager` component:
- `Apply Mobile Defaults` ✔ (locks 60 FPS, vSync off, never-sleep, run-in-background off)
- `Auto Pause On Focus Lost` ✔ (auto-pauses when Android backgrounds the app)
- `Persist Across Scenes` ✔ (DontDestroyOnLoad)
- `Game Minutes Per Real Second`: 1.0 → a full in-game day every 24 real minutes (GTA V pace ≈ 0.5)
- `Start Hour`: 9.0

**ObjectPoolManager** — empty GameObject, add the `ObjectPoolManager` component:
- Create the database: `Assets → Create → OpenWorld → Core → Object Pool Database`
- Add entries for every pooled prefab (traffic cars, peds, casings, blood, skidmarks…)
- `Prewarm On Awake` ✔ — instances exist before gameplay begins, so no rent-time spikes

> Execution orders guarantee `GameManager.Awake` → `ObjectPoolManager.Awake` → every gameplay `Awake/Start`, so modules can rent pools safely the moment they initialize.

## 2. Module Registration Pattern (Modules 1–6)

Every manager-level system implements `IGameModule` and registers itself. It gets ticked
from GameManager's single pump — deterministically ordered by `InitOrder`:

```csharp
public sealed class TrafficManager : IGameModule
{
    public string ModuleName => "Traffic Manager";
    public int InitOrder => 300;                 // lower runs earlier
    public bool UpdateEnabled => true;
    public bool FixedUpdateEnabled => false;
    public bool LateUpdateEnabled => false;

    public void OnRegistered(GameManager game)   { /* resolve references, allocate tables */ }
    public void ModuleUpdate(float deltaTime)    { /* simulation — keep it allocation-free */ }
    public void ModuleFixedUpdate(float dt)      { }
    public void ModuleLateUpdate(float dt)       { }
    public void OnUnregistered()                 { /* release, unsubscribe */ }
}

public sealed class TrafficBootstrap : MonoBehaviour
{
    private void Awake()
    {
        GameManager.RegisterModule(new TrafficManager());
    }
}
```

Cross-module lookups are zero-GC dictionary hits:

```csharp
if (GameManager.TryGetModule(out TrafficManager traffic))
    traffic.SpawnVehicleNear(position);
```

## 3. Event Bus Patterns

**Subscribe in OnEnable / unsubscribe in OnDisable — always paired:**

```csharp
private void OnEnable()
{
    GameEvents<WeaponFiredEvent>.Subscribe(OnWeaponFired);
    GameEvents<PlayerDiedEvent>.Subscribe(OnPlayerDied);
}

private void OnDisable()
{
    GameEvents<WeaponFiredEvent>.Unsubscribe(OnWeaponFired);
    GameEvents<PlayerDiedEvent>.Unsubscribe(OnPlayerDied);
}

private void OnWeaponFired(in WeaponFiredEvent evt)   // 'in' → no copy of the payload
{
    _lastGunshotPosition = evt.MuzzlePosition;        // write straight into fields, no locals churn
}
```

**Publishing is a struct constructor + static call — zero heap traffic:**

```csharp
GameEvents<EntityKilledEvent>.Publish(new EntityKilledEvent
{
    Victim = victim,
    Killer = killer,
    FinalDamage = finalDamage
});
```

Rules:
- Main thread only (mobile game loop is single-threaded by design).
- Payload strings must be cached constants or pre-built strings — never `$"..."` per publish.
- Never Publish inside a Subscribe handler of the same event type (reentrancy).

## 4. Pooling Patterns

**Standard rent-and-fire (VFX, casings):**

```csharp
ObjectPoolManager.Instance.Rent(_casingPrefab, muzzlePos, muzzleRot);
```
Pair the prefab with `PoolAutoReturn` (lifetime) or `PoolParticleAutoReturn`
(alive-check + safety timeout) and cleanup is fully automatic.

**Manual lifecycle (traffic cars, peds):**

```csharp
GameObject car = ObjectPoolManager.Instance.Rent(_sedanPrefab, spawnPos, spawnRot);
// … simulate …
ObjectPoolManager.Instance.Return(car);
ObjectPoolManager.Instance.ReturnDelayed(car, 3f);   // e.g. after a wrecked car burns out
```

**Pre-configure then activate (weapon pickups, special spawns):**

```csharp
GameObject instance = ObjectPoolManager.Instance.RentInactive(_pickupPrefab);
instance.transform.SetPositionAndRotation(pos, rot);
ConfigurePickup(instance, weaponId, ammo);
ObjectPoolManager.Instance.Activate(instance);       // SetActive(true) + OnRentFromPool hooks
```

**Code-registered pools** (dynamically authored content):

```csharp
int poolKey = ObjectPoolManager.Instance.RegisterPool(skidmarkPrefab,
    prewarmCount: 128, hardCap: 512, expandBatch: 64, allowExpansion: true);
```

## 5. Performance Budgets Enforced by Module 0

| Concern | Mechanism |
|---|---|
| Update-loop GC | Struct events, `in` params, cached arrays, Stack/Dictionary pooling, no LINQ/coroutines/string ops in tick paths |
| MonoBehaviour overhead | Single tick pump in GameManager; flat module arrays |
| Spawn hitches | Boot-time pre-warm + burst expansion (batch Instantiate, not per-object) |
| Memory ceilings | Per-pool `HardCap`; rents are denied (with dev-build diagnostics) beyond cap |
| Cross-scene leaks | Pool containers live under DontDestroyOnLoad root; destroyed-instance records purged on every scene unload |
| Domain-reload-disabled workflows | Statics (`_hub`, `_instance`, module table) reset via `RuntimeInitializeOnLoadMethod(SubsystemRegistration)` |
| Enter-background jank | Android focus/pause events auto-pause and broadcast `ApplicationPauseEvent` |

## 6. Diagnostics

- Dev builds and Editor log: double returns, foreign-object returns, scene-object prefabs, pool cap denials, free-stack corruption (auto-healed).
- `ObjectPoolManager.Instance.GetAllPoolStats(list)` → live counts per pool for the debug HUD.
- `GameManager.SmoothedFrameRate` → rolling FPS for adaptive-quality systems (Module 6).
- `GameManager.SetPhase` refuses invalid transitions loudly — gameplay logic can never silently corrupt the app state machine.
