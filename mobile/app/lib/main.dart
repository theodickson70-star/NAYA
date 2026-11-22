import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'screens/agent/agent_home.dart';
import 'screens/login_screen.dart';
import 'screens/owner/owner_home.dart';
import 'services/api.dart';
import 'theme.dart';
import 'widgets/common.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(url: AppConfig.supabaseUrl, anonKey: AppConfig.supabaseAnonKey);
  runApp(const PayPointApp());
}

class PayPointApp extends StatelessWidget {
  const PayPointApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: buildNayaTheme(),
      home: const AuthGate(),
    );
  }
}

/// Inaamua skrini ipi ionyeshwe: Login, Kamilisha usajili, Mmiliki au Wakala
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});
  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  @override
  void initState() {
    super.initState();
    sb.auth.onAuthStateChange.listen((event) {
      if (mounted) setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    if (sb.auth.currentSession == null) return const LoginScreen();
    return FutureBuilder<Map<String, dynamic>?>(
      key: ValueKey(sb.auth.currentUser?.id),
      future: Api.myProfile(),
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                BrandMark(size: 56, showName: false),
                SizedBox(height: 20),
                SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3)),
              ]),
            ),
          );
        }
        if (snap.hasError) {
          return Scaffold(
            body: Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text(errorText(snap.error!)),
                const SizedBox(height: 12),
                FilledButton(onPressed: () => setState(() {}), child: const Text('Jaribu tena')),
                TextButton(onPressed: Api.signOut, child: const Text('Toka')),
              ]),
            ),
          );
        }
        final p = snap.data;
        if (p == null) return CompleteRegistrationScreen(onDone: () => setState(() {}));
        if (p['active'] == false) {
          return Scaffold(
            body: Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.block, size: 56, color: Naya.danger),
                const SizedBox(height: 12),
                const Text('Akaunti yako imezimwa. Wasiliana na mmiliki.'),
                TextButton(onPressed: Api.signOut, child: const Text('Toka')),
              ]),
            ),
          );
        }
        if (p['role'] == 'owner') return OwnerHome(profile: p);
        return AgentHome(profile: p);
      },
    );
  }
}
