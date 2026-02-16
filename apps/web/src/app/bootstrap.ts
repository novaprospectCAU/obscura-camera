import { CameraLabApp } from "./CameraLabApp";

export function bootstrapCameraLabApp(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) {
    throw new Error("Missing #app root element.");
  }

  const app = new CameraLabApp(root);
  app.mount();
}

