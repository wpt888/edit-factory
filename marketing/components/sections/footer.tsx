export function Footer() {
  return (
    <footer className="border-t mt-20 py-12 bg-background">
      <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <div className="font-bold text-lg">Blipost</div>
          <p className="text-muted-foreground text-sm mt-2">Automated video production for indie creators.</p>
          <p className="text-muted-foreground text-xs mt-4">© 2026 Blipost. All rights reserved.</p>
        </div>
        <div>
          <h3 className="font-semibold text-sm">Product</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li><a href="#features" className="text-muted-foreground hover:text-foreground">Features</a></li>
            <li><a href="#pricing" className="text-muted-foreground hover:text-foreground">Pricing</a></li>
            <li><a href="#faq" className="text-muted-foreground hover:text-foreground">FAQ</a></li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold text-sm">Legal</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li><a href="/legal/privacy" className="text-muted-foreground hover:text-foreground">Privacy</a></li>
            <li><a href="/legal/terms" className="text-muted-foreground hover:text-foreground">Terms</a></li>
            <li><a href="/legal/cookies" className="text-muted-foreground hover:text-foreground">Cookies</a></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
