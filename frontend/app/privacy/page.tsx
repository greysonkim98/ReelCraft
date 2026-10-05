import { Contact, H2, LegalPage, Operator } from '@/components/LegalPage';

export const metadata = { title: 'Privacy Policy · ReelCraft' };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="October 5, 2026">
      <p>
        ReelCraft is operated by <Operator />. This policy explains what we collect when you use ReelCraft and who receives it. Questions:{' '}
        <Contact />.
      </p>

      <H2>Your videos stay on your device</H2>
      <p>
        Videos you add are read, analyzed, edited and encoded inside your browser. They are not uploaded to our servers or to any third
        party, and we cannot see them. The finished reel is created on your device and is only shared if you choose to share or download it.
      </p>

      <H2>What we collect</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Account:</strong> when you sign in with Google, Google Firebase Authentication gives us a user ID and the email address
          (and name, if shared) of your Google account.
        </li>
        <li>
          <strong>Caption requests:</strong> when you ask for AI captions we receive the sentence describing your reel, the notes you typed for
          your clips, the length of each scene and simple scene tags. We store this with the generated captions in a project record linked to
          your account.
        </li>
        <li>
          <strong>Usage records:</strong> how many caption runs your account used each day, and a log of each AI call (time, model, number of
          scenes). We may also keep a one-way hash of your network address to limit abuse; the address itself is not stored.
        </li>
        <li>
          <strong>Progress status:</strong> the current stage and percentage of your render, so other devices signed in to your account can see it.
        </li>
        <li>
          <strong>On your device:</strong> your sign-in session is kept in your browser storage. We do not use advertising or analytics cookies.
        </li>
      </ul>

      <H2>Who receives your information</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>Google (Firebase):</strong> sign-in, our database and website hosting.</li>
        <li><strong>Groq, Inc. (United States):</strong> the text of a caption request is sent to Groq&apos;s API to generate captions.</li>
        <li><strong>Render:</strong> hosts our API server, which processes caption requests.</li>
      </ul>
      <p>We do not sell your personal information and we do not share it for advertising.</p>

      <H2>Do not put sensitive details in your notes</H2>
      <p>
        Notes and descriptions are sent to the services above. Please do not include passwords, health, financial or other sensitive
        information, or private details about other people.
      </p>

      <H2>Your choices</H2>
      <p>
        You can ask us to access or delete the information linked to your account, or to correct it, by emailing <Contact />. If you are a
        California resident you may have additional rights under California privacy law, including the right to know, delete and correct
        personal information and to not be discriminated against for exercising these rights.
      </p>

      <H2>Children</H2>
      <p>ReelCraft is not intended for children under 13 and we do not knowingly collect personal information from them.</p>

      <H2>Changes</H2>
      <p>We will post changes on this page and update the date above.</p>
    </LegalPage>
  );
}
