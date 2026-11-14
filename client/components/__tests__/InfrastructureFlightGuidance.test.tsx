import React from "react";
import { Linking } from "react-native";
import renderer, { act } from "react-test-renderer";
import { InfrastructureFlightGuidance } from "../InfrastructureFlightGuidance";
import { supplementalInfrastructureAsGeozones } from "../../lib/energyInfrastructureZones";

describe("InfrastructureFlightGuidance", () => {
  it("renders conditional rules, dated sources and public authority contacts without clearance actions", () => {
    const [zone] = supplementalInfrastructureAsGeozones("CH", [{
      id: "mast", kind: "power_mast", name: "Mast", source: "OpenStreetMap",
      geometry: { type: "Point", coordinates: [8, 47] },
      distanceMeters: 50, officialMatch: "not_found",
    }]);
    let tree: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<InfrastructureFlightGuidance zone={zone} textColor="#000" linkColor="#00f" />); });
    const rendered = JSON.stringify(tree!.toJSON());
    expect(rendered).toContain("Netzebene 2");
    expect(rendered).toContain("keine pauschale");
    expect(rendered).toContain("2026-10-12");
    expect(rendered).toContain("Fedlex");
    expect(rendered).toContain("rpas@bazl.admin.ch");
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const index = zone.links!.findIndex((link) => link.url === "rpas@bazl.admin.ch");
    const mail = tree!.root.findAllByProps({ testID: `infrastructure-flight-link-${index}` })[0];
    act(() => mail.props.onPress());
    expect(open).toHaveBeenCalledWith("mailto:rpas@bazl.admin.ch");
    open.mockRestore();
    act(() => tree!.unmount());
  });

  it("does not attach foreign law to an official or German zone", () => {
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<InfrastructureFlightGuidance zone={{ name: "Zone", layerLabel: "Zone", details: "" }} textColor="#000" linkColor="#00f" />);
    });
    expect(tree!.toJSON()).toBeNull();
    act(() => tree!.unmount());
  });
});
