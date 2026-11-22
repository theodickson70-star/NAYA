import 'package:supabase_flutter/supabase_flutter.dart';

SupabaseClient get sb => Supabase.instance.client;

/// Toa ujumbe wa kosa unaosomeka kwa mtumiaji
String errorText(Object e) {
  if (e is PostgrestException) return e.message;
  if (e is AuthException) {
    final m = e.message.toLowerCase();
    if (m.contains('invalid login')) return 'Barua pepe au nenosiri si sahihi';
    if (m.contains('email not confirmed')) return 'Thibitisha barua pepe yako kwanza';
    return e.message;
  }
  if (e is FunctionException) {
    final d = e.details;
    if (d is Map && d['error'] != null) return d['error'].toString();
    return 'Hitilafu (${e.status})';
  }
  final s = e.toString();
  return s.replaceFirst('Exception: ', '');
}

class Api {
  // ---------- Akaunti ----------
  static Future<Map<String, dynamic>?> myProfile() async {
    final uid = sb.auth.currentUser?.id;
    if (uid == null) return null;
    return await sb.from('profiles').select('*, outlets(name)').eq('id', uid).maybeSingle();
  }

  static Future<Map<String, dynamic>?> myBusiness() async =>
      await sb.from('businesses').select('*, plans(*)').maybeSingle();

  static Future<void> registerBusiness(String business, String name, String phone) async {
    await sb.rpc('register_business', params: {
      'p_business_name': business,
      'p_full_name': name,
      'p_phone': phone,
    });
  }

  // ---------- Wakala ----------
  static Future<String?> myOpenSession() async => await sb.rpc('my_open_session') as String?;

  static Future<Map<String, dynamic>> sessionSummary(String id) async =>
      Map<String, dynamic>.from(await sb.rpc('session_summary', params: {'p_session': id}) as Map);

  static Future<void> openSession(double cash, List<Map<String, dynamic>> floats) async {
    await sb.rpc('open_session', params: {'p_opening_cash': cash, 'p_floats': floats});
  }

  static Future<void> recordTransaction({
    required String network,
    required String type,
    required double amount,
    String? phone,
    String? name,
    String? reference,
    double? commission,
  }) async {
    await sb.rpc('record_transaction', params: {
      'p_network': network,
      'p_type': type,
      'p_amount': amount,
      'p_customer_phone': phone,
      'p_customer_name': name,
      'p_reference': reference,
      'p_commission': commission,
    });
  }

  static Future<void> recordAdjustment(String kind, String? network, double amount, String? note) async {
    await sb.rpc('record_adjustment', params: {
      'p_kind': kind,
      'p_network': network,
      'p_amount': amount,
      'p_note': note,
    });
  }

  static Future<void> voidTransaction(String id, String reason) async {
    await sb.rpc('void_transaction', params: {'p_tx': id, 'p_reason': reason});
  }

  static Future<Map<String, dynamic>> closeSession(
      double cash, List<Map<String, dynamic>> floats, String? notes) async {
    return Map<String, dynamic>.from(await sb.rpc('close_session', params: {
      'p_cash_counted': cash,
      'p_floats': floats,
      'p_notes': notes,
    }) as Map);
  }

  static Future<List<Map<String, dynamic>>> sessionTransactions(String sessionId) async =>
      await sb.from('transactions').select().eq('session_id', sessionId).order('created_at', ascending: false);

  static Future<List<Map<String, dynamic>>> sessionAdjustments(String sessionId) async =>
      await sb.from('adjustments').select().eq('session_id', sessionId).order('created_at', ascending: false);

  static Future<List<Map<String, dynamic>>> outletLines(String outletId) async =>
      await sb.from('outlet_lines').select().eq('outlet_id', outletId).order('network');

  // ---------- Mmiliki ----------
  static Future<Map<String, dynamic>> ownerDashboard() async =>
      Map<String, dynamic>.from(await sb.rpc('owner_dashboard') as Map);

  static Future<Map<String, dynamic>> report(DateTime from, DateTime to, String? outletId) async =>
      Map<String, dynamic>.from(await sb.rpc('report_range', params: {
        'p_from': _d(from),
        'p_to': _d(to),
        'p_outlet': outletId,
      }) as Map);

  static String _d(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  static Future<List<Map<String, dynamic>>> outlets() async =>
      await sb.from('outlets').select().order('name');

  /// Inarudisha id ya kibanda
  static Future<String> saveOutlet({String? id, required String businessId, required String name, String? location, bool active = true}) async {
    final row = {'business_id': businessId, 'name': name, 'location': location, 'active': active};
    if (id == null) {
      final r = await sb.from('outlets').insert(row).select('id').single();
      return r['id'].toString();
    }
    await sb.from('outlets').update(row).eq('id', id);
    return id;
  }

  static Future<void> saveLines(String businessId, String outletId, Map<String, String?> lines) async {
    await sb.from('outlet_lines').delete().eq('outlet_id', outletId);
    final rows = lines.entries
        .map((e) => {'business_id': businessId, 'outlet_id': outletId, 'network': e.key, 'agent_number': e.value})
        .toList();
    if (rows.isNotEmpty) await sb.from('outlet_lines').insert(rows);
  }

  static Future<List<Map<String, dynamic>>> agents() async =>
      await sb.from('profiles').select('*, outlets(name)').eq('role', 'agent').order('full_name');

  static Future<void> createAgent({
    required String email,
    required String password,
    required String fullName,
    String? phone,
    String? outletId,
  }) async {
    await sb.functions.invoke('create-agent', body: {
      'email': email,
      'password': password,
      'full_name': fullName,
      'phone': phone,
      'outlet_id': outletId,
    });
  }

  /// values mfano: {'outlet_id': '...'} au {'active': false}
  static Future<void> updateAgent(String id, Map<String, dynamic> values) async =>
      await sb.from('profiles').update(values).eq('id', id);

  static Future<List<Map<String, dynamic>>> tiers() async =>
      await sb.from('commission_tiers').select().order('network').order('tx_type').order('min_amount');

  static Future<void> addTier(Map<String, dynamic> row) async => await sb.from('commission_tiers').insert(row);
  static Future<void> deleteTier(String id) async => await sb.from('commission_tiers').delete().eq('id', id);

  static Future<void> updateBusiness(String id, Map<String, dynamic> values) async =>
      await sb.from('businesses').update(values).eq('id', id);

  static Future<List<Map<String, dynamic>>> notifications() async =>
      await sb.from('notifications').select().order('created_at', ascending: false).limit(200);

  static Future<void> markAllRead() async =>
      await sb.from('notifications').update({'read': true}).eq('read', false);

  static Future<List<Map<String, dynamic>>> plans() async =>
      await sb.from('plans').select().order('price_tzs');

  static Future<String> subscribe(String plan, int months, String phone) async {
    final r = await sb.functions.invoke('subscribe', body: {'plan': plan, 'months': months, 'phone': phone});
    final d = r.data;
    return (d is Map ? d['message'] : null)?.toString() ?? 'Angalia simu yako kuthibitisha malipo.';
  }
}
