/**
 * Unterpfad `@kreiseck/kasseneck-api/register` — die **Anmeldung der
 * Browser-Kasse**: ein Geraet koppeln, seine Kassen-Benutzer auflisten, einen
 * davon per PIN anmelden (mit oder ohne Benutzerauswahl), und die entstandene
 * Sitzung erneuern bzw. beenden.
 *
 * Diese Aufrufe stehen vor allen anderen: ohne sie gibt es keine
 * Identitaet, mit der ein Beleg entstehen koennte.
 *
 * **Sie zerfallen in zwei Haelften, und der Unterschied ist wesentlich:**
 *
 * | Aufruf | Anmeldung |
 * |---|---|
 * | [pairRegisterDevice] | **keine** — der Kopplungs-Code ist der Nachweis |
 * | [listRegisterUsersForDevice] | **keine** — der Ausweis des Geraets ist der Nachweis |
 * | [unpairRegisterDevice] | **keine** — der Ausweis des Geraets; sperrt es im Backend (Entkoppeln) |
 * | [registerUserLogin] | **keine** — dieser Aufruf erzeugt sie |
 * | [registerPinLogin] | **keine** — wie registerUserLogin, nur ohne Benutzerauswahl (Geraete-Modus `pin`) |
 * | [renewRegisterSession] | Kassen-Benutzer (`registerUserAuth`) |
 * | [endRegisterSession] | Kassen-Benutzer (`registerUserAuth`) |
 *
 * Die ersten drei nehmen deshalb **keinen Transport** entgegen, sondern nur
 * die Verbindungsangaben, und bauen ihn selbst — die anmeldungsfreie Anmeldung
 * dahinter wird bewusst nicht exportiert, sonst liesse sich damit jeder Aufruf
 * des Pakets ohne Anmeldung bauen (ausfuehrlich in pairing.ts). Die letzten
 * beiden nehmen den Transport wie jeder andere Endpunkt-Aufruf und stehen
 * zusaetzlich in `createKasseneckApi`.
 *
 * Der uebliche Ablauf einer Browser-Kasse:
 *
 * ```ts
 * import {
 *   pairRegisterDevice, listRegisterUsersForDevice, registerUserLogin,
 * } from '@kreiseck/kasseneck-api/register';
 *
 * // Einmalig: Code aus dem Panel gegen den Geraeteausweis tauschen.
 * const geraet = await pairRegisterDevice({ code: 'K7NPQR34', label: 'Schank' });
 *
 * // Bei jedem Schichtwechsel: auswaehlen und per PIN anmelden.
 * const { users } = await listRegisterUsersForDevice(geraet);
 * const sitzung = await registerUserLogin({
 *   ...geraet, userId: users[0]!.id, pin: '1234', cashregisterId: geraet.cashregisterId,
 * });
 * ```
 *
 * Mit `sitzung.customToken` meldet sich der Verbraucher bei Firebase an; das
 * daraus entstehende ID-Token und `sitzung.sessionId` ergeben zusammen
 * `registerUserAuth` — ab da laeuft alles Weitere ueber den ueblichen Weg.
 */

export {
  type RegisterDeviceConnection,
  type RegisterDeviceCredentials,
  type PairRegisterDeviceOptions,
  type PairedRegisterDevice,
  type RegisterUserKind,
  type RegisterUserSummary,
  type RegisterUserPerms,
  type RegisterScope,
  type RegisterUser,
  type RegisterUserSession,
  type ListRegisterUsersForDeviceOptions,
  type RegisterUserLoginOptions,
  type RegisterPinLoginOptions,
  type RegisterPinPolicy,
  type RegisterLoginMode,
  type RegisterDeviceUsers,
  type RegisterClientInfo,
  type RegisterGeo,
  type RegisterGeraeteAngaben,
  pairRegisterDevice,
  listRegisterUsersForDevice,
  unpairRegisterDevice,
  registerUserLogin,
  registerPinLogin,
} from './pairing.js';

export { renewRegisterSession, endRegisterSession } from './session.js';
