// zitadel-cli: managed-file v1
import { Component, OnInit } from "@angular/core";
import {
  ZitadelLoginComponent,
  ZitadelSessionComponent,
  configureZitadel,
} from "@zitadel/sdk-angular";
// zitadel-ng.cjs writes this module from ZITADEL_PROJECT_ID: npm run dev, build and test run it.
import { ZITADEL_PROJECT_ID } from "./zitadel-project";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [ZitadelLoginComponent, ZitadelSessionComponent],
  templateUrl: "./app.html",
})
export class App implements OnInit {
  protected readonly project = configureZitadel({
    projectId: ZITADEL_PROJECT_ID,
    proxyPath: "/__nextgen",
  });
  protected readonly path = window.location.pathname;

  ngOnInit(): void {
    if (this.path === "/") {
      window.location.replace("/login");
    }
  }
}
