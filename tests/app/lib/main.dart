import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart';
import 'screens/agent/agent_home.dart';
import 'screens/login_screen.dart';
import 'screens/owner/owner_home.dart';
import 'services/api.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(url: AppConfig.supabaseUrl, anonKey: AppConfig.supabaseAnonKey);
  runApp(const WakalaLinkApp());
}

class WakalaLinkApp extends StatelessWidget {
  const WakalaLinkApp({super.key});

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF0B5FA5);
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: seed),
        inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
        appBarTheme: const AppBarTheme(centerTitle: false),
      ),
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
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (snap.hasError) {
          return Scaffold(
            body: Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text(errorText(snap.error!)),
                const SizedBox(height: 12),
                FilledButton(onPressed: () => setState(() {}), child: const Text('Jaribu tena')),
                TextButton(onPressed: () => sb.auth.signOut(), child: const Text('Toka')),
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
                const Icon(Icons.block, size: 56, color: Colors.red),
                const SizedBox(height: 12),
                const Text('Akaunti yako imezimwa. Wasiliana na mmiliki.'),
                TextButton(onPressed: () => sb.auth.signOut(), child: const Text('Toka')),
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
