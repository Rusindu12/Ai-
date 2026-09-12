import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/theme.dart';
import '../providers/app_state.dart';
import '../providers/providers.dart';
import '../widgets/common.dart';
import 'ai/ai_trading_screen.dart';
import 'alerts/alerts_screen.dart';
import 'dashboard/dashboard_screen.dart';
import 'orders/orders_screen.dart';
import 'portfolio/portfolio_screen.dart';
import 'settings/settings_screen.dart';
import 'trade/trade_screen.dart';

/// The authenticated container: bottom navigation, the live stream
/// subscription per tab, the mode banner and the idle-lock overlay.
class BootedShell extends ConsumerStatefulWidget {
  const BootedShell({super.key});

  @override
  ConsumerState<BootedShell> createState() => _BootedShellState();
}

class _BootedShellState extends ConsumerState<BootedShell> {
  int _index = 0;

  static const List<String> _titles = ['Dashboard', 'Trade', 'AI Auto-Trading', 'Portfolio', 'Orders & History'];

  @override
  void initState() {
    super.initState();
    // The socket only needs the tickers for the pairs the user actually looks at,
    // which keeps backend weight low.
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncSubscriptions());
  }

  void _syncSubscriptions() {
    final symbol = ref.read(selectedSymbolProvider);
    final interval = ref.read(selectedIntervalProvider);
    final markets = ref.read(serverConfigProvider).valueOrNull?.markets ?? const ['BTCUSDT'];
    final channels = <String>{
      'ticker',
      for (final s in markets.take(10)) 'kline:$s:$interval',
      'signals',
      'notifications',
      if (_index == 1) 'depth:$symbol',
      if (_index == 1) 'trades:$symbol',
    };
    ref.read(realtimeProvider).subscribe(channels);
  }

  void _goTo(int index) {
    setState(() => _index = index);
    _syncSubscriptions();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider).valueOrNull;
    final connection = ref.watch(connectionStateProvider).valueOrNull ?? ref.watch(realtimeProvider).currentState;
    final account = ref.watch(accountProvider).valueOrNull;
    final notifications = ref.watch(notificationsProvider).valueOrNull ?? const [];
    final unread = notifications.where((n) => !n.delivered).length;

    if (auth == null || !auth.signedIn) {
      // Session dropped or idled out: splash/login takes over from app.dart, but
      // keep this defensive so a race never leaves a blank screen.
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final screens = <Widget>[
      DashboardScreen(onOpenTrade: () => _goTo(1)),
      const TradeScreen(),
      const AiTradingScreen(),
      const PortfolioScreen(),
      const OrdersScreen(),
    ];

    return PopScope(
      canPop: _index == 0,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) setState(() => _index = 0);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Row(
            children: [
              Text(_titles[_index]),
              if (account != null) ...[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: (account.paperTrading ? AppColors.ai : AppColors.up).withOpacity(0.16),
                    borderRadius: BorderRadius.circular(5),
                  ),
                  child: Text(
                    account.demoMode ? 'DEMO' : (account.paperTrading ? 'PAPER' : 'LIVE'),
                    style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                      color: account.demoMode ? AppColors.info : (account.paperTrading ? AppColors.ai : AppColors.up),
                    ),
                  ),
                ),
              ],
            ],
          ),
          actions: [
            ConnectionBadge(state: connection, events: ref.read(realtimeProvider).eventsReceived),
            IconButton(
              tooltip: 'Alerts',
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AlertsScreen())),
              icon: Badge(
                isLabelVisible: unread > 0,
                label: Text('$unread'),
                child: const Icon(Icons.notifications_none, size: 22),
              ),
            ),
            IconButton(
              tooltip: 'Settings',
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SettingsScreen())),
              icon: const Icon(Icons.settings_outlined, size: 21),
            ),
            const SizedBox(width: 4),
          ],
          bottom: const PreferredSize(preferredSize: Size.fromHeight(2), child: ModeBannerSlot()),
        ),
        body: IndexedStack(index: _index, children: screens),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: _goTo,
          destinations: [
            const NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Home'),
            const NavigationDestination(icon: Icon(Icons.show_chart_outlined), selectedIcon: Icon(Icons.show_chart), label: 'Trade'),
            const NavigationDestination(
              icon: Icon(Icons.auto_awesome_outlined),
              selectedIcon: Icon(Icons.auto_awesome),
              label: 'AI',
            ),
            const NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), selectedIcon: Icon(Icons.account_balance_wallet), label: 'Wallet'),
            const NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Orders'),
          ],
        ),
        floatingActionButton: _index == 0
            ? FloatingActionButton.extended(
                onPressed: () => _goTo(1),
                backgroundColor: AppColors.up,
                foregroundColor: Colors.black87,
                icon: const Icon(Icons.swap_horiz),
                label: const Text('Trade', style: TextStyle(fontWeight: FontWeight.w800)),
              )
            : null,
      ),
    );
  }
}

/// Reads the account to decide whether to show the demo/paper/live banner.
class ModeBannerSlot extends ConsumerWidget {
  const ModeBannerSlot({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final account = ref.watch(accountProvider).valueOrNull;
    if (account == null) return const SizedBox.shrink();
    return ModeBanner(paperTrading: account.paperTrading, demoMode: account.demoMode, canWithdraw: account.canWithdraw);
  }
}
